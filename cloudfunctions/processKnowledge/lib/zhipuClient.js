/**
 * 智谱 HTTP 客户端 + 响应适配器
 *
 * 三类调用：
 *   1. callZhipuChatAPI       - GLM 对话补全（/chat/completions）
 *   2. callZhipuKBRetrieval   - 智谱托管知识库检索（/knowledge/retrieve）
 *   3. callZhipuKBGet         - 智谱知识库文档/详情 GET 请求
 *
 * 适配器：
 *   - adaptZhipuResultToRagFormat  检索结果 → 通用 ragResult 格式
 *   - adaptZhipuDocument           智谱原始文档 → 前端友好格式
 *   - mapKnowledgeType / mapEmbeddingStat
 */

const https = require('https')
const crypto = require('crypto')
const config = require('../config')
const { getRagConfig } = require('./ragConfig')
const { isRetryableRerankFailure } = require('./retrievalFallback')

// 智谱知识库检索端点（与 paas/v4 前缀不同，单独硬编码完整 URL）
// 官方文档：POST https://open.bigmodel.cn/api/llm-application/open/knowledge/retrieve
const ZHIPU_KB_RETRIEVE_URL = 'https://open.bigmodel.cn/api/llm-application/open/knowledge/retrieve'
const RERANK_FAILURE_COOLDOWN_MS = 5 * 60 * 1000
let rerankDisabledUntil = 0

// 智谱知识库 API 基础路径
const ZHIPU_KB_API_BASE = 'https://open.bigmodel.cn/api/llm-application/open'

// ============ GLM Chat Completions ============

/**
 * 调用智谱 GLM 对话 API（非流式）
 * @returns {Promise<{statusCode, data, raw}>}
 */
function callZhipuChatAPI({ model, messages, temperature, maxTokens, apiKey, webSearch = false, thinkingConfig = null, timeout = null }) {
  return new Promise((resolve, reject) => {
    // P0-1: 关闭 stream，避免响应为 SSE 多片段导致 JSON.parse 失败
    // 真流式由独立的 chatStream 云函数（HTTP 触发）实现，这里保持非流式
    const requestBody = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    }

    // GLM-4.5+ 混合思考模型参数：
    // - thinking.type: enabled/disabled（官方标准格式）
    // - reasoning_effort: low/medium/high/max（GLM-5.2）
    // 兼容旧调用方的 enable_thinking:false，并转换为标准 thinking 格式。
    // 仅当 thinkingConfig 显式传入时生效，避免影响非思考模型
    if (thinkingConfig) {
      if (['enabled', 'disabled'].includes(thinkingConfig.type)) {
        requestBody.thinking = { type: thinkingConfig.type }
      } else if (thinkingConfig.enable_thinking === false) {
        requestBody.thinking = { type: 'disabled' }
      } else if (thinkingConfig.reasoning_effort) {
        requestBody.thinking = { type: 'enabled' }
        requestBody.reasoning_effort = thinkingConfig.reasoning_effort
      }
    }

    // 联网搜索工具：智谱 GLM web_search，启用后模型会按需自动检索网页
    // search_result=true 让响应返回搜索结果引用，便于前端展示来源
    if (webSearch) {
      requestBody.tools = [{
        type: 'web_search',
        web_search: { enable: true, search_result: true }
      }]
    }

    const postData = JSON.stringify(requestBody)

    const url = new URL(config.zhipu.baseUrl + '/chat/completions')
    const requestTimeout = Math.min(Math.max(Number(timeout) || config.timeouts.chatUpstream, 1000), config.timeouts.chatUpstream)
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      // 云函数总预算 120s，给结果处理和网络收尾预留约 20s。
      timeout: requestTimeout
    }

    const req = https.request(options, (res) => {
      let body = ''
      console.log(`[ZhipuClient] 响应头到达: statusCode=${res.statusCode}`)
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        let parsed = null
        try { parsed = body ? JSON.parse(body) : null } catch (e) { /* keep null */ }
        console.log(`[ZhipuClient] 响应结束: body长度=${body.length}`)
        resolve({ statusCode: res.statusCode, data: parsed, raw: body })
      })
    })

    req.on('error', err => {
      console.error(`[ZhipuClient] 请求错误: ${err.message}, code=${err.code}`)
      reject(err)
    })
    req.on('timeout', () => {
      console.error(`[ZhipuClient] 请求超时（${requestTimeout}ms无响应），destroy 连接`)
      req.destroy()
      reject(new Error('请求超时'))
    })
    req.write(postData)
    req.end()
    console.log(`[ZhipuClient] 请求已发出，等待响应...`)
  })
}

// ============ 智谱托管知识库检索 ============

// 请求体：{ query, knowledge_ids:[id], recall_method:'mixed', top_k, top_n, recall_ratio, rerank_status }
function requestZhipuKBRetrieval({ apiKey, payload, timeout }) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload)
    const requestId = payload.request_id
    const fail = (message, details = {}) => {
      const error = new Error(`[request_id=${requestId}] ${message}`)
      error.requestId = requestId
      Object.assign(error, details)
      return error
    }
    const url = new URL(ZHIPU_KB_RETRIEVE_URL)
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        let parsed = null
        try { parsed = body ? JSON.parse(body) : null } catch (e) { /* keep null */ }
        if (res.statusCode !== 200) {
          reject(fail(`智谱知识库检索 HTTP ${res.statusCode}: ${body.substring(0, 200)}`, { httpStatus: res.statusCode }))
          return
        }
        if (!parsed) {
          reject(fail('智谱知识库检索返回空响应'))
          return
        }
        if (parsed.code && parsed.code !== 200) {
          reject(fail(`智谱知识库业务错误 code=${parsed.code}: ${parsed.message || ''}`, {
            businessCode: parsed.code,
            businessMessage: parsed.message || ''
          }))
          return
        }
        resolve(parsed)
      })
    })
    req.on('error', err => reject(fail(err.message || '智谱知识库检索网络错误')))
    req.on('timeout', () => { req.destroy(); reject(fail('智谱知识库检索请求超时')) })
    req.write(postData)
    req.end()
  })
}

async function callZhipuKBRetrieval({ knowledgeId, query, topK, apiKey, ragConfig: configSnapshot }) {
  const ragConfig = configSnapshot || await getRagConfig()
  const recallMethodMap = { vector: 'embedding', text: 'keyword' }
  const configuredRecallMethod = ragConfig.retrieval?.recallMethod
  const recallMethod = recallMethodMap[configuredRecallMethod] || configuredRecallMethod
  const validRecallMethods = ['embedding', 'keyword', 'mixed']
  const normalizedRecallMethod = validRecallMethods.includes(recallMethod) ? recallMethod : 'mixed'
  const normalizedTopK = Math.min(Math.max(Number(topK) || 8, 1), 20)
  const configuredTopN = Number(ragConfig.zhipu?.topN)
  const normalizedTopN = Math.max(normalizedTopK, Math.min(Math.max(configuredTopN || 10, 1), 100))
  const configuredRatio = Number(ragConfig.retrieval?.recallRatio)
  // 官方范围是 (0, 100)，避免后台边界值触发上游业务异常。
  const normalizedRatio = Math.min(Math.max(Number.isFinite(configuredRatio) ? configuredRatio : 80, 1), 99)
  const configuredRerankStatus = Number(ragConfig.retrieval?.rerankStatus) === 1 ? 1 : 0
  const rerankCircuitOpen = configuredRerankStatus === 1 && Date.now() < rerankDisabledUntil
  const rerankStatus = rerankCircuitOpen ? 0 : configuredRerankStatus
  const configuredTimeout = Number(ragConfig.zhipu?.cloudTimeout)
  const requestTimeout = Math.min(Math.max(configuredTimeout || 15000, 5000), 50000)
  const makePayload = (useRerank) => ({
    query,
    knowledge_ids: [knowledgeId],
    request_id: `rag_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    top_k: normalizedTopK,
    top_n: normalizedTopN,
    recall_method: normalizedRecallMethod,
    recall_ratio: normalizedRatio,
    rerank_status: useRerank
  })

  const firstPayload = makePayload(rerankStatus)
  console.log(`[ZhipuKB] request_id=${firstPayload.request_id}, top_k=${normalizedTopK}, top_n=${normalizedTopN}, ` +
    `recall_method=${normalizedRecallMethod}, recall_ratio=${normalizedRatio}, rerank_status=${rerankStatus}`)
  try {
    const result = await requestZhipuKBRetrieval({ apiKey, payload: firstPayload, timeout: requestTimeout })
    if (rerankCircuitOpen) {
      result.retrievalFallback = { reason: 'rerank_cooldown' }
    }
    return result
  } catch (error) {
    // 智谱重排服务可能单独故障。基础召回仍可用时自动关闭 rerank 重试一次，
    // 避免公共知识库因为可选增强能力异常而整体不可用。
    if (rerankStatus === 1 && isRetryableRerankFailure(error.businessCode, error.businessMessage)) {
      rerankDisabledUntil = Date.now() + RERANK_FAILURE_COOLDOWN_MS
      const fallbackPayload = makePayload(0)
      console.warn(`[ZhipuKB] rerank 不可用，关闭重排重试: original_request_id=${error.requestId}, ` +
        `fallback_request_id=${fallbackPayload.request_id}`)
      const result = await requestZhipuKBRetrieval({ apiKey, payload: fallbackPayload, timeout: requestTimeout })
      result.retrievalFallback = {
        reason: 'rerank_unavailable',
        originalRequestId: error.requestId,
        fallbackRequestId: fallbackPayload.request_id
      }
      return result
    }
    throw error
  }
}

// ============ 智谱知识库 GET 请求（文档列表/详情） ============

// 通用 GET 请求（智谱知识库 API 文档列表/详情均为 GET）
function callZhipuKBGet(pathWithQuery, apiKey) {
  return new Promise((resolve, reject) => {
    const fullUrl = ZHIPU_KB_API_BASE + pathWithQuery
    const url = new URL(fullUrl)
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      timeout: 20000
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        let parsed = null
        try { parsed = body ? JSON.parse(body) : null } catch (e) { /* keep null */ }
        if (res.statusCode !== 200) {
          reject(new Error(`智谱 API HTTP ${res.statusCode}: ${body.substring(0, 200)}`))
          return
        }
        if (!parsed) {
          reject(new Error('智谱 API 返回空响应'))
          return
        }
        if (parsed.code && parsed.code !== 200) {
          reject(new Error(`智谱业务错误 code=${parsed.code}: ${parsed.message || ''}`))
          return
        }
        resolve(parsed)
      })
    })

    req.on('error', err => reject(err))
    req.on('timeout', () => { req.destroy(); reject(new Error('智谱 API 请求超时')) })
    req.end()
  })
}

// ============ 适配器 ============

/**
 * 分数归一化：智谱 score 可能是 0-1 或 0-100，统一成 0-100
 * 抽取为独立工具函数，消除多处重复的归一化逻辑
 * @param {number} rawScore 原始分数
 * @returns {number} 0-100 区间整数
 */
function normalizeScore(rawScore) {
  if (typeof rawScore !== 'number' || isNaN(rawScore)) return 0
  return rawScore > 1 ? Math.round(rawScore) : Math.round(rawScore * 100)
}

// 智谱返回适配成现有 ragResult 格式
// 官方返回格式：{ data: [{ text, score, metadata: { _id, knowledge_id, doc_id, doc_name, doc_url, contextual_text } }], code, message, timestamp }
// 统一返回 0-100 的 score，让前端 ragRetriever 的 /100 归一化逻辑无需改动
function adaptZhipuResultToRagFormat(zhipuRes, duration) {
  const list = (zhipuRes && zhipuRes.data) || []

  const results = list.map((item, idx) => {
    const meta = item.metadata || {}
    const normalizedScore = normalizeScore(item.score)
    const docName = meta.doc_name || '智谱知识库文档'
    // 内容 = 切片文本 + 上下文增强内容（若开启）
    const content = [item.text, meta.contextual_text].filter(Boolean).join('\n')
    return {
      id: meta._id || meta.doc_id || `zhipu_${idx}`,
      title: docName,
      content,
      score: normalizedScore,
      source: docName,
      documentId: meta.doc_id || '',
      chunkId: meta._id || '',
      searchMode: 'zhipu',
      vectorSimilarity: normalizedScore,
      textRelevance: 0,
      // 智谱元数据，便于前端溯源展示
      zhipuMeta: {
        knowledgeId: meta.knowledge_id,
        docUrl: meta.doc_url,
        rawScore: item.score
      }
    }
  })

  return {
    success: true,
    results,
    searchMode: 'zhipu',
    coverage: { zhipu: true, count: results.length },
    totalFound: results.length,
    duration,
    degraded: Boolean(zhipuRes && zhipuRes.retrievalFallback),
    retrievalFallback: (zhipuRes && zhipuRes.retrievalFallback) || null
  }
}

// 文档切片类型映射
function mapKnowledgeType(type) {
  const map = { 1: '按标题段落', 2: '问答对', 3: '按行', 5: '自定义', 6: '按页', 7: '单切片' }
  return map[type] || '未知'
}

// 向量化状态映射
function mapEmbeddingStat(stat) {
  const map = { 0: '处理中', 1: '已就绪', 2: '失败' }
  return map[stat] || '未知'
}

// 文档格式适配（智谱原始 → 前端友好格式）
function adaptZhipuDocument(doc) {
  return {
    id: doc.id || '',
    name: doc.name || '未命名文档',
    url: doc.url || '',
    knowledgeType: mapKnowledgeType(doc.knowledge_type),
    knowledgeTypeRaw: doc.knowledge_type,
    sentenceSize: doc.sentence_size || 0,
    length: doc.length || 0,
    wordNum: doc.word_num || 0,
    embeddingStat: mapEmbeddingStat(doc.embedding_stat),
    embeddingStatRaw: doc.embedding_stat,
    embeddingReady: doc.embedding_stat === 1,
    failInfo: doc.failInfo || null
  }
}

module.exports = {
  callZhipuChatAPI,
  callZhipuKBRetrieval,
  callZhipuKBGet,
  adaptZhipuResultToRagFormat,
  adaptZhipuDocument,
  mapKnowledgeType,
  mapEmbeddingStat,
  normalizeScore,
  isRetryableRerankFailure
}
