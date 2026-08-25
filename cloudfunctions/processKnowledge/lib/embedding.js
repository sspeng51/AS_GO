/**
 * 智谱 Embedding 客户端
 *
 * 调用智谱 embedding-3 模型，将文本批量转向量。
 * 端点：POST https://open.bigmodel.cn/api/paas/v4/embeddings
 * 请求体：{ model, input:[...], dimensions, encoding_format }
 * 响应体：{ data:[{ embedding:[...], index, object }], model, usage }
 *
 * 设计：
 * - 批量调用，每批 BATCH_SIZE 条，降低请求次数
 * - 按 index 排序回填，保证输入顺序与输出顺序一致
 * - 批次级重试：429/5xx/网络错误退避重试，避免单批失败拖垮整篇文档
 */

const https = require('https')
const config = require('../config')

const EMBEDDING_URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings'
const EMBEDDING_MODEL = 'embedding-3'
const EMBEDDING_DIM = 1024
const BATCH_SIZE = 10 // 智谱 embedding 单次最多 64 条，10 条稳妥

// 从 config 读取重试参数（与 config.zhipu.embedding.maxRetries / retryDelay 对齐）
const MAX_RETRIES = (config.zhipu && config.zhipu.embedding && config.zhipu.embedding.maxRetries) || 3
const RETRY_DELAY = (config.zhipu && config.zhipu.embedding && config.zhipu.embedding.retryDelay) || 1000

/**
 * 批量获取文本向量
 * @param {string[]} texts 待向量化文本数组
 * @param {string} apiKey 智谱 API Key
 * @returns {Promise<number[][]>} 向量数组，顺序与 texts 一致
 */
async function embedBatch(texts, apiKey) {
  if (!texts || texts.length === 0) return []
  if (!apiKey) throw new Error('embedBatch 缺少 apiKey')

  const results = new Array(texts.length)
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    // 批次级重试：单批失败不放弃整篇文档
    const embeddings = await _callEmbeddingWithRetry(batch, apiKey)
    for (let j = 0; j < embeddings.length; j++) {
      results[i + j] = embeddings[j]
    }
  }
  return results
}

/**
 * 带重试的 Embedding 调用
 * - 429 限流：指数退避（RETRY_DELAY * 2^attempt）
 * - 5xx 服务端错误：固定退避
 * - 网络错误/超时：固定退避重试
 * - 4xx 非限流错误（如 401）：不重试，直接抛出
 */
async function _callEmbeddingWithRetry(input, apiKey) {
  let lastError = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await _callEmbeddingAPI(input, apiKey)
    } catch (err) {
      lastError = err
      const msg = err.message || ''
      // 判断是否可重试
      const is429 = /HTTP 429/.test(msg)
      const is5xx = /HTTP 5\d\d/.test(msg)
      const isNetworkErr = /超时|timeout|ECONNRESET|ECONNREFUSED|socket/i.test(msg)
      const isRetryable = is429 || is5xx || isNetworkErr

      if (!isRetryable || attempt >= MAX_RETRIES) {
        throw err
      }

      // 429 指数退避，其他固定退避
      const delay = is429 ? RETRY_DELAY * Math.pow(2, attempt) : RETRY_DELAY
      console.warn(`[Embedding] 第 ${attempt + 1}/${MAX_RETRIES} 次重试 (${delay}ms): ${msg.substring(0, 100)}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError || new Error('Embedding 调用失败')
}

function _callEmbeddingAPI(input, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
      dimensions: EMBEDDING_DIM,
      encoding_format: 'float'
    })

    const url = new URL(EMBEDDING_URL)
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
      timeout: 30000
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Embedding HTTP ${res.statusCode}: ${body.substring(0, 200)}`))
          return
        }
        try {
          const parsed = JSON.parse(body)
          const data = parsed.data || []
          // 按 index 排序，保证顺序
          data.sort((a, b) => (a.index || 0) - (b.index || 0))
          resolve(data.map(d => d.embedding || []))
        } catch (e) {
          reject(new Error('Embedding 响应解析失败: ' + e.message))
        }
      })
    })

    req.on('error', err => reject(err))
    req.on('timeout', () => { req.destroy(); reject(new Error('Embedding 请求超时')) })
    req.write(postData)
    req.end()
  })
}

module.exports = { embedBatch, EMBEDDING_MODEL, EMBEDDING_DIM }
