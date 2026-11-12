/**
 * 智谱 API 客户端（前端代理版）
 *
 * 安全：API Key 不再放在小程序前端，所有 LLM 调用通过云函数 processKnowledge 的
 * chat.complete action 代理，由云函数环境变量 ZHIPU_API_KEY 或 BIGMODEL_API_KEY 注入密钥。
 *
 * 真流式：chatStream() 通过 web-admin server 的 SSE 代理（/api/chat/stream）逐块接收，
 * 首字延迟从「完整生成时间」降到 1-3s。不支持时降级到 chat() + 打字机。
 */

const appConfig = require('../config/config')
const Utf8StreamDecoder = require('../utils/utf8StreamDecoder')

class ZhipuAPI {
  constructor() {
    // 云函数部署上限为 120s；客户端在 115s 主动结束，预留网络收尾时间。
    this.cloudTimeout = appConfig.timeouts.cloudFunction
  }

  /**
   * 真流式对话：通过 web-admin server SSE 代理逐块接收内容
   * 首字延迟 ≈ 智谱首 token 时间（1-3s），远优于打字机模拟
   *
   * @param {Array<{role, content}>} messages
   * @param {Object} options
   *   - {function} onChunk(content, fullContent) 每收到一个回答增量回调
   *   - {function} onReasoning(content, fullReasoning) 每收到一个思考增量回调
   *   - {function} onTask(task) 暴露 wx.request task 供外部 abort
   *   - {number} temperature
   *   - {number} maxTokens
   *   - {boolean} webSearch
   *   - {Object} thinkingConfig GLM-5.x 思考参数
   * @returns {Promise<{content, finishReason}>}
   */
  async chatStream(messages, options = {}) {
    const { onChunk, onReasoning, onTask, temperature, maxTokens, webSearch, thinkingConfig } = options
    const model = options.model || appConfig.zhipu.model
    const streamServerUrl = appConfig.stream.serverUrl

    if (!streamServerUrl) throw new Error('STREAM_NOT_CONFIGURED')
    const tokenResponse = await wx.cloud.callFunction({
      name: 'processKnowledge',
      data: { action: 'chat.streamToken', data: {} }
    })
    const tokenResult = tokenResponse && tokenResponse.result
    if (!tokenResult || !tokenResult.success || !tokenResult.token) {
      throw new Error((tokenResult && tokenResult.error) || '无法获取流式令牌')
    }

    return new Promise((resolve, reject) => {
      let fullContent = ''
      let fullReasoning = ''
      let finishReason = null
      let completed = false
      let settled = false
      let buffer = '' // SSE 分块缓冲
      const utf8Decoder = new Utf8StreamDecoder()

      const fail = (message) => {
        if (settled) return
        settled = true
        const error = new Error(message)
        error.partialContent = fullContent
        error.finishReason = finishReason
        reject(error)
      }
      const processEvents = (isFinal = false) => {
        const events = buffer.replace(/\r\n/g, '\n').split('\n\n')
        buffer = isFinal ? '' : events.pop()
        for (const evt of events) {
          if (!evt.trim()) continue
          const lines = evt.split('\n')
          const eventType = (lines.find(line => line.startsWith('event:')) || '').substring(6).trim()
          const dataLines = lines.filter(line => line.startsWith('data:')).map(line => line.substring(5).trim())
          const dataStr = dataLines.join('\n')
          if (eventType === 'done' || dataStr === '[DONE]') { completed = true; continue }
          if (eventType === 'finish') {
            try { finishReason = JSON.parse(dataStr).finish_reason || finishReason } catch (e) {}
            continue
          }
          if (eventType === 'error') {
            try { fail(JSON.parse(dataStr).error || '流式服务错误') } catch (e) { fail('流式服务错误') }
            return
          }
          if (!dataStr) continue
          try {
            const parsed = JSON.parse(dataStr)
            if (parsed.content) {
              fullContent += parsed.content
              onChunk && onChunk(parsed.content, fullContent)
            }
            if (parsed.reasoning) {
              fullReasoning += parsed.reasoning
              onReasoning && onReasoning(parsed.reasoning, fullReasoning)
            }
          } catch (e) { /* 非业务 JSON 忽略 */ }
        }
      }

      const task = wx.request({
        url: `${streamServerUrl}/api/chat/stream`,
        method: 'POST',
        enableChunked: true,
        responseType: 'arraybuffer',
        timeout: appConfig.timeouts.streamRequest,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenResult.token}`
        },
        data: { messages, model, temperature, maxTokens, webSearch, thinkingConfig },
        success: (res) => {
          // 非 200 时整体失败（分块模式下 success 仅在结束时触发）
          if (settled) return
          const tail = utf8Decoder.decode(new Uint8Array(0), true)
          if (tail) buffer += tail
          processEvents(true)
          if (settled) return
          if (res.statusCode !== 200) return fail(`流式服务 HTTP ${res.statusCode}`)
          if (!completed) return fail('STREAM_INCOMPLETE')
          settled = true
          resolve({ content: fullContent, reasoning: fullReasoning, finishReason, completed: true })
        },
        fail: (err) => {
          if (err.errMsg && /abort/i.test(err.errMsg)) {
            fail('ABORTED')
          } else {
            fail(err.errMsg || '流式请求失败')
          }
        }
      })

      // 逐块接收：ArrayBuffer → UTF-8 字符串 → 按 SSE 事件解析
      if (task && task.onChunkReceived) {
        task.onChunkReceived((res) => {
          try {
            const chunkStr = utf8Decoder.decode(res.data)
            buffer += chunkStr
            processEvents()
          } catch (e) {
            // 单块解析失败不中断流
          }
        })
      }

      // 暴露 task 供外部 abort
      if (onTask) {
        try { onTask(task) } catch (e) {}
      }
    })
  }

  /**
   * 调用智谱 Chat Completions（经云函数代理）
   * @param {Array<{role, content}>} messages
   * @param {Object} options - { temperature, maxTokens, onStream, maxRetries, webSearch }
   * @returns {Promise<{content, usage, model, webSearch, webSearchInfo, finishReason}>}
   */
  async chat(messages, options = {}) {
    const {
      temperature,
      maxTokens,
      onStream = null,
      maxRetries = 1,
      webSearch = false,
      model = appConfig.zhipu.model,
      thinkingConfig = appConfig.zhipu.thinking,
      onTask = null     // 暴露底层 task 供外部 abort
    } = options

    let lastError = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this._callCloudChat(
          { messages, model, temperature, maxTokens, webSearch, thinkingConfig },
          { onTask }
        )

        if (!result.success) {
          // 429 限流 / 5xx 服务端错误：可重试
          const isRetryable = result.statusCode === 429 || (result.statusCode >= 500 && result.statusCode < 600)
          if (isRetryable && attempt < maxRetries) {
            // P1-3: 429 指数退避：1.5s → 3s → 6s
            const delay = result.statusCode === 429 ? 1500 * Math.pow(2, attempt) : 1000
            await new Promise(r => setTimeout(r, delay))
            continue
          }
          throw new Error(result.error || 'API 调用失败')
        }

        const response = {
          content: result.content || '',
          reasoning: result.reasoning || '',
          usage: result.usage || {},
          model: result.model || '',
          webSearch: result.webSearch === true,
          webSearchInfo: result.webSearchInfo || null,
          // 透传 finish_reason：'length' 表示因 max_tokens 截断
          finishReason: result.finish_reason || null
        }

        // 兼容旧的 onStream 回调（模拟流式）
        if (onStream && response.content) {
          onStream(response.content, response.content)
        }

        return response
      } catch (error) {
        // 用户主动 abort：直接抛出，不重试
        if (error.message === 'ABORTED') {
          throw error
        }
        lastError = error
        // 网络错误可重试
        if (attempt < maxRetries && error.errMsg) {
          await new Promise(r => setTimeout(r, 1000))
          continue
        }
        throw error
      }
    }

    throw lastError || new Error('API 调用失败')
  }

  /**
   * 调用云函数代理 Zhipu chat
   * 返回 Promise，并通过 options.onTask 暴露 task 对象供外部 abort
   */
  _callCloudChat({ messages, model, temperature, maxTokens, webSearch, thinkingConfig }, options = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { task && task.abort && task.abort() } catch (e) {}
        reject(new Error('云函数调用超时'))
      }, this.cloudTimeout)

      const task = wx.cloud.callFunction({
        name: 'processKnowledge',
        data: {
          action: 'chat.complete',
          data: {
            messages,
            model,
            temperature,
            maxTokens,
            webSearch,
            thinkingConfig
          }
        },
        success: (res) => {
          clearTimeout(timer)
          resolve(res.result || { success: false, error: '云函数无返回' })
        },
        fail: (err) => {
          clearTimeout(timer)
          // 用户主动 abort 时 errMsg 包含 abort
          if (err.errMsg && /abort/i.test(err.errMsg)) {
            reject(new Error('ABORTED'))
          } else {
            const e = new Error(err.errMsg || '云函数调用失败')
            e.errMsg = err.errMsg
            reject(e)
          }
        }
      })

      // 暴露 task 供外部 abort
      if (options.onTask) {
        try { options.onTask(task) } catch (e) {}
      }
    })
  }
}

module.exports = ZhipuAPI
