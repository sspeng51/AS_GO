/**
 * 智谱对话代理 + 对话消息存储 handler
 *
 * actions:
 *   - chat.complete      智谱 GLM 对话补全（避免 API Key 暴露到小程序包）
 *   - chat.saveMessage   保存单条对话消息
 *   - chat.saveMessages  批量保存消息（一轮对话合并一次调用）
 */

const config = require('../config')
const crypto = require('crypto')
const { cloud, db, COLLECTIONS, ensureCollection, safeAdd, maskId } = require('../lib/db')
const { callZhipuChatAPI } = require('../lib/zhipuClient')
const { extractText, getExt } = require('../lib/fileParser')
const { isOwnedByAny } = require('../lib/attachmentOwnership')
const { getChatUsageLimits, evaluateUsage } = require('../lib/usagePolicy')
const { createStreamToken } = require('../lib/streamToken')
const { applyExpertPolicy } = require('../lib/expertPolicy')

function getTrustedOpenId(context) {
  try {
    const wxContext = cloud.getWXContext()
    if (wxContext && (wxContext.OPENID || wxContext.openid)) {
      return wxContext.OPENID || wxContext.openid
    }
  } catch (e) {}
  return context && (context.OPENID || context.openid) || ''
}

function hashIdentity(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').substring(0, 24)
}

async function resolveTrustedUser(context) {
  const openid = getTrustedOpenId(context)
  if (!openid) throw new Error('用户身份校验失败')

  try {
    const result = await db.collection(COLLECTIONS.USERS)
      .where({ openid })
      .limit(1)
      .get()
    const user = result.data && result.data[0]
    if (user) {
      return {
        openid,
        userId: user._id,
        registered: true,
        nickName: user.nickName || '',
        avatarUrl: user.avatarUrl || ''
      }
    }
  } catch (e) {
    const message = String(e && (e.message || e.errMsg) || '')
    if (!/not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(message)) throw e
  }

  return {
    openid,
    userId: `guest_${hashIdentity(openid)}`,
    registered: false,
    nickName: '',
    avatarUrl: ''
  }
}

async function enforceChatUsageLimit(context) {
  const identity = await resolveTrustedUser(context)
  await ensureCollection(COLLECTIONS.AI_USAGE)
  const date = new Date().toISOString().slice(0, 10)
  const minuteWindow = new Date().toISOString().slice(0, 16)
  const limits = getChatUsageLimits(identity.registered)
  const usageId = `${date}_${hashIdentity(identity.openid)}`
  await db.runTransaction(async transaction => {
    const ref = transaction.collection(COLLECTIONS.AI_USAGE).doc(usageId)
    let current = null
    let exists = true
    try {
      const result = await ref.get()
      current = result && result.data
    } catch (e) {
      const message = String(e && (e.message || e.errMsg) || '')
      if (!/not exist|not found|DATABASE_DOCUMENT_NOT_EXIST/i.test(message)) throw e
      exists = false
    }

    const decision = evaluateUsage(current, minuteWindow, limits)
    if (!decision.allowed) {
      const error = new Error(decision.reason)
      error.statusCode = 429
      throw error
    }

    const now = new Date()
    if (!exists) {
      await ref.set({
        data: {
          ...decision.next,
          date,
          identityHash: hashIdentity(identity.openid),
          registered: identity.registered,
          createdAt: now,
          updatedAt: now
        }
      })
    } else {
      await ref.update({ data: { ...decision.next, registered: identity.registered, updatedAt: now } })
    }
  })
  return identity
}

// ============ Chat Completion（前端代理调用，避免 API Key 暴露到小程序包） ============

async function handleChatComplete(data, context) {
  const t0 = Date.now()
  const { messages, temperature, maxTokens, model, webSearch } = data || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return { success: false, error: 'messages 不能为空' }
  }
  if (messages.length > 20) {
    return { success: false, error: 'messages 不能超过 20 条' }
  }
  const promptChars = messages.reduce((sum, item) => sum + String(item && item.content || '').length, 0)
  if (promptChars > 50000) {
    return { success: false, error: '对话上下文过长' }
  }
  const expertRequest = applyExpertPolicy(messages, { enabled: process.env.EXPERT_POLICY_ENABLED !== 'false' })

  try {
    await enforceChatUsageLimit(context)
  } catch (e) {
    return {
      success: false,
      error: e.message || '调用额度校验失败',
      statusCode: e.statusCode || 401
    }
  }

  const apiKey = config.zhipu.apiKey
  if (!apiKey) {
    return { success: false, error: '云函数未配置 ZHIPU_API_KEY 或 BIGMODEL_API_KEY 环境变量' }
  }

  // 模型从统一配置读取（config/config.js 的 zhipu.model）
  // 修改模型只需改 config/config.js 一处，无需改本文件
  const configuredModel = config.zhipu.model || 'glm-5.3'
  const allowedModels = new Set(
    String(process.env.ALLOWED_CHAT_MODELS || `${configuredModel},glm-4.5-flash`)
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )
  const useModel = process.env.ALLOW_MODEL_OVERRIDE === 'true' && allowedModels.has(model)
    ? model
    : configuredModel
  const useTemp = typeof temperature === 'number' ? temperature : (config.zhipu.temperature || 0.7)
  // 限制回答长度，避免混合思考模型在云函数时限内生成过久。
  const useMaxTokens = typeof maxTokens === 'number'
    ? Math.min(Math.max(Math.floor(maxTokens), 1), 4096)
    : 2048
  // 联网搜索开关：仅当显式传 true 时启用，避免无谓 token 消耗
  const useWebSearch = webSearch === true

  // 诊断日志：prompt 总长度 + 模型 + 参数
  console.log(`[Chat] 开始调用: model=${useModel}, maxTokens=${useMaxTokens}, ` +
    `messages=${messages.length}, promptChars=${promptChars}, webSearch=${useWebSearch}`)

  // 云函数部署上限为 120s。云函数内不重试，避免一次请求耗尽整个预算；
  // 网络重试由客户端在新的云函数调用中完成。
  const MAX_RETRIES = 0
  let lastError = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const t1 = Date.now()
      const result = await callZhipuChatAPI({
        model: useModel,
        messages: expertRequest.messages,
        temperature: useTemp,
        maxTokens: useMaxTokens,
        apiKey,
        webSearch: useWebSearch,
        // GLM-5.x 思考模式配置（从 config.zhipu.thinking 读取，仅对混合思考模型生效）
        thinkingConfig: config.zhipu.thinking || null
      })
      const apiDuration = Date.now() - t1
      console.log(`[Chat] 智谱 API 返回: ${apiDuration}ms, statusCode=${result.statusCode}`)

      if (result.statusCode === 200) {
        const parsed = result.data
        if (!parsed.choices || !parsed.choices[0]) {
          console.error(`[Chat] 响应格式异常: raw=${(result.raw || '').substring(0, 500)}`)
          return { success: false, error: 'Invalid response format' }
        }
        const msg = parsed.choices[0].message || {}
        // 混合思考模型的响应结构兼容提取：
        // - content: 最终回答（可能为空，思考模型有时只输出 reasoning）
        // - reasoning_content: 思考过程（混合思考模型特有）
        // 优先 content，为空则降级用 reasoning_content，再为空则报错
        let content = msg.content || ''
        const reasoning = msg.reasoning_content || msg.reasoning || ''
        if (!content && reasoning) {
          console.warn(`[Chat] content 为空，降级使用 reasoning_content (长度=${reasoning.length})`)
          content = reasoning
        }
        if (!content) {
          console.error(`[Chat] content 和 reasoning_content 均为空: raw=${(result.raw || '').substring(0, 500)}`)
          return { success: false, error: 'AI 返回内容为空' }
        }
        // 智谱 web_search 启用时,响应中可能带 web_search_info(搜索结果引用)
        const webSearchInfo = parsed.web_search_info || msg.tool_links || null
        console.log(`[Chat] 完成: 总耗时 ${Date.now() - t0}ms, content=${content.length}, reasoning=${reasoning.length}, finish_reason=${parsed.choices[0].finish_reason}`)
        return {
          success: true,
          content,
          reasoning,  // 透传思考过程（可选用于调试）
          usage: parsed.usage || {},
          model: parsed.model || useModel,
          expertPolicy: expertRequest.metadata,
          webSearch: useWebSearch,
          webSearchInfo,
          // 透传 finish_reason：'length' 表示因 max_tokens 截断，前端据此提示用户
          finish_reason: parsed.choices[0].finish_reason || null
        }
      }

      // 429 限流 / 5xx 服务端错误：可重试
      if ((result.statusCode === 429 || result.statusCode >= 500) && attempt < MAX_RETRIES) {
        console.warn(`[Chat] HTTP ${result.statusCode}, 准备重试`)
        await new Promise(r => setTimeout(r, result.statusCode === 429 ? 1500 : 1000))
        continue
      }

      // 401 等不可重试错误。400 时保留上游的简短错误信息，便于定位模型或参数不兼容，
      // 但不暴露完整响应及任何敏感请求信息。
      const upstreamMessage = result.data && result.data.error && result.data.error.message
        ? String(result.data.error.message).substring(0, 200)
        : ''
      const errMsg = result.statusCode === 401
        ? 'API Key 无效或已过期'
        : result.statusCode === 429
          ? 'API 调用频率超限，请稍后重试'
          : `API Error: ${result.statusCode}${upstreamMessage ? `: ${upstreamMessage}` : ''}`
      console.error(`[Chat] 失败: ${errMsg}, raw=${(result.raw || '').substring(0, 200)}`)
      return { success: false, error: errMsg, statusCode: result.statusCode }
    } catch (err) {
      lastError = err
      console.error(`[Chat] 异常: ${err.message}, 耗时 ${Date.now() - t0}ms`)
      // 网络错误可重试
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000))
        continue
      }
      return { success: false, error: err.message || '云函数调用智谱失败' }
    }
  }

  return { success: false, error: (lastError && lastError.message) || 'API 调用失败' }
}

async function handleChatStreamToken(data, context) {
  try {
    const identity = await enforceChatUsageLimit(context)
    const token = createStreamToken(process.env.STREAM_SHARED_SECRET, identity.userId)
    return { success: true, token, expiresIn: 120 }
  } catch (error) {
    const statusCode = error.statusCode || (/STREAM_SHARED_SECRET/.test(error.message) ? 503 : 401)
    return { success: false, error: error.message || '无法签发流式令牌', statusCode }
  }
}

/**
 * 抽取聊天附件中的文本。附件必须属于当前登录用户可访问的云存储，
 * 服务端下载并解析，前端只接收有限长度的纯文本结果。
 */
async function handleChatExtractAttachment(data, context) {
  const { fileID, fileName, type } = data || {}
  if (!fileID || typeof fileID !== 'string' || !/^cloud:\/\//.test(fileID)) {
    return { success: false, error: '附件 fileID 无效' }
  }

  const identity = await resolveTrustedUser(context)
  if (!identity.registered) {
    return { success: false, error: '请登录后使用附件解析功能', statusCode: 401 }
  }
  if (!isOwnedByAny(fileID, [identity.userId, identity.openid], 'chat-attachments')) {
    return { success: false, error: '无权访问该附件，请重新上传', statusCode: 403 }
  }

  const safeName = String(fileName || (type === 'image' ? 'image.jpg' : 'attachment'))
    .replace(/[\\/\0]/g, '_')
    .substring(0, 200)
  const ext = getExt(safeName) || (type === 'image' ? 'jpg' : '')

  try {
    const result = await cloud.downloadFile({ fileID })
    const buffer = result && result.fileContent
    if (!buffer || !buffer.length) {
      return { success: false, error: '附件内容为空' }
    }
    if (buffer.length > 10 * 1024 * 1024) {
      return { success: false, error: '附件不能超过 10MB' }
    }

    const parsed = await extractText(buffer, ext, {
      apiKey: config.zhipu.apiKey,
      visionModel: config.zhipu.visionModel,
      baseUrl: config.zhipu.baseUrl
    })
    const text = String(parsed.text || '').trim()
    if (!text) {
      return {
        success: false,
        error: parsed.note || '未能从附件中提取文本',
        method: parsed.method || 'unknown'
      }
    }

    return {
      success: true,
      fileName: safeName,
      text: text.substring(0, 8000),
      truncated: text.length > 8000,
      method: parsed.method || 'unknown'
    }
  } catch (error) {
    console.warn('[Attachment] 解析失败:', error.message)
    return { success: false, error: '附件解析失败，请稍后重试' }
  }
}

// ============ 对话消息存储 ============

/**
 * 存储单条对话消息到 conversations 集合
 * 异步执行，不阻塞主流程
 */
async function saveConversationMessage({ userId, sessionId, direction, content, messageType = 'text', metadata = {} }) {
  if (!sessionId || !content) {
    console.warn('[Conversation] saveConversationMessage 跳过: sessionId或content为空')
    return
  }
  const uid = (userId && String(userId).trim()) || 'anonymous'

  try {
    const doc = {
      userId: uid,
      sessionId: String(sessionId).trim(),
      direction,
      content: String(content).substring(0, 10000),
      messageType,
      timestamp: new Date(),
      metadata: { ...metadata, source: 'processKnowledge' },
      createdAt: new Date()
    }
    // safeAdd 内部处理集合不存在时的自动创建+重试，消除重复逻辑
    const result = await safeAdd(COLLECTIONS.CONVERSATIONS, doc)
    console.log(`[Conversation] 消息已保存: id=${result._id}, dir=${direction}, uid=${maskId(uid)}, meta=${JSON.stringify(metadata).slice(0, 100)}`)
  } catch (err) {
    console.warn('[Conversation] 消息保存失败:', err.message?.substring(0, 200), 'code:', err.code)
  }
}

async function handleChatSaveMessage(data, context) {
  const { userId, sessionId, direction, content, messageType, metadata } = data || {}
  if (!sessionId || !direction || !content) {
    return { success: false, error: '缺少必要参数: sessionId, direction, content' }
  }
  if (!['user', 'ai'].includes(direction)) {
    return { success: false, error: 'direction 必须是 user 或 ai' }
  }

  try {
    const identity = await resolveTrustedUser(context)
    await saveConversationMessage({
      userId: identity.userId,
      sessionId,
      direction,
      content,
      messageType,
      metadata: {
        ...(metadata || {}),
        nickName: identity.nickName,
        avatarUrl: identity.avatarUrl
      }
    })
    return { success: true, message: '消息保存成功' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * 批量保存消息（一轮对话的用户消息 + AI 回答合并为一次云函数调用）
 */
async function handleChatSaveMessages(data, context) {
  const { userId, sessionId, messages } = data || {}
  if (!sessionId || !Array.isArray(messages) || messages.length === 0) {
    return { success: false, error: '缺少必要参数: sessionId, messages' }
  }
  if (messages.length > 20) {
    return { success: false, error: '单次批量保存不能超过 20 条' }
  }

  try {
    const identity = await resolveTrustedUser(context)
    const uid = identity.userId
    const sid = String(sessionId).trim().substring(0, 128)
    const now = new Date()

    const docs = []
    for (const msg of messages) {
      if (!msg || !msg.direction || !msg.content) continue
      if (!['user', 'ai'].includes(msg.direction)) continue
      docs.push({
        userId: uid,
        sessionId: sid,
        direction: msg.direction,
        content: String(msg.content).substring(0, 10000),
        messageType: msg.messageType || 'text',
        timestamp: msg.timestamp ? new Date(msg.timestamp) : now,
        metadata: {
          ...(msg.metadata || {}),
          nickName: identity.nickName,
          avatarUrl: identity.avatarUrl,
          source: 'processKnowledge'
        },
        createdAt: now
      })
    }

    if (docs.length === 0) {
      return { success: false, error: '没有有效的消息可保存' }
    }

    // 并行写入（safeAdd 内部处理集合不存在），收集结果
    const results = await Promise.allSettled(
      docs.map(doc => safeAdd(COLLECTIONS.CONVERSATIONS, doc))
    )
    const saved = results.filter(r => r.status === 'fulfilled').length
    const failed = results.length - saved
    if (failed > 0) {
      const firstErr = results.find(r => r.status === 'rejected')
      console.warn(`[Conversation] 批量保存部分失败: saved=${saved}, failed=${failed}, err=${firstErr?.reason?.message}`)
      // 回滚本次已写入的记录，保证重试不会产生重复/残缺的一轮对话。
      const rollbackIds = results
        .filter(r => r.status === 'fulfilled' && r.value && r.value._id)
        .map(r => r.value._id)
      await Promise.allSettled(
        rollbackIds.map(id => db.collection(COLLECTIONS.CONVERSATIONS).doc(id).remove())
      )
      return { success: false, saved: 0, failed, error: '对话保存不完整，已回滚，请重试' }
    }
    return { success: true, saved, failed: 0, message: `批量保存完成: 成功 ${saved} 条` }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

module.exports = {
  handleChatComplete,
  handleChatStreamToken,
  handleChatExtractAttachment,
  handleChatSaveMessage,
  handleChatSaveMessages,
  saveConversationMessage
}
