const express = require('express')
const https = require('https')
const rateLimit = require('express-rate-limit')
const { verifyStreamToken } = require('../utils/streamToken')

const router = express.Router()
const usedTokenIds = new Map()
const streamUpstreamTimeout = Math.min(
  Math.max(Number(process.env.CHAT_STREAM_TIMEOUT_MS) || 100000, 10000),
  110000
)

const streamLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: req => req.streamIdentity,
  message: { error: '流式请求过于频繁，请稍后再试' }
})

function authenticateStreamRequest(req, res, next) {
  try {
    const auth = String(req.headers.authorization || '')
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: '缺少流式令牌' })
    const claims = verifyStreamToken(auth.substring(7), process.env.STREAM_SHARED_SECRET)
    const now = Math.floor(Date.now() / 1000)
    for (const [id, expiry] of usedTokenIds) {
      if (expiry < now) usedTokenIds.delete(id)
    }
    if (usedTokenIds.has(claims.jti)) return res.status(401).json({ error: '流式令牌已使用' })
    usedTokenIds.set(claims.jti, claims.exp)
    req.streamIdentity = claims.sub
    next()
  } catch (error) {
    res.status(401).json({ error: error.message })
  }
}

router.post('/stream', authenticateStreamRequest, streamLimiter, (req, res) => {
  const { messages, temperature, maxTokens, model, webSearch, thinkingConfig } = req.body || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 不能为空' })
  }
  if (messages.length > 20) {
    return res.status(400).json({ error: 'messages 不能超过 20 条' })
  }
  const promptChars = messages.reduce((sum, item) => sum + String(item && item.content || '').length, 0)
  if (promptChars > 50000) {
    return res.status(413).json({ error: '对话上下文过长' })
  }

  const apiKey = process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: '服务器未配置 ZHIPU_API_KEY' })
  }

  const defaultModel = process.env.ZHIPU_MODEL || 'glm-5.2'
  const allowedModels = (process.env.ZHIPU_ALLOWED_MODELS || 'glm-5.2,glm-4.5-flash')
    .split(',').map(item => item.trim()).filter(Boolean)
  const useModel = model || defaultModel
  if (!allowedModels.includes(useModel)) {
    return res.status(400).json({ error: '不允许使用该模型' })
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const requestedMaxTokens = Number(maxTokens) || 2048
  const requestBody = {
    model: useModel,
    messages,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    max_tokens: Math.min(Math.max(requestedMaxTokens, 1), 4096),
    stream: true
  }

  const safeThinkingConfig = thinkingConfig || (useModel.startsWith('glm-5') ? { reasoning_effort: 'medium' } : null)
  if (safeThinkingConfig) {
    if (safeThinkingConfig.enable_thinking === false) {
      requestBody.enable_thinking = false
    } else if (['low', 'medium', 'high'].includes(safeThinkingConfig.reasoning_effort)) {
      requestBody.thinking = { type: 'enabled' }
      requestBody.reasoning_effort = safeThinkingConfig.reasoning_effort
    }
  }

  if (webSearch) {
    requestBody.tools = [{
      type: 'web_search',
      web_search: { enable: true, search_result: true }
    }]
  }

  const postData = JSON.stringify(requestBody)

  const options = {
    hostname: 'open.bigmodel.cn',
    path: '/api/paas/v4/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: streamUpstreamTimeout
  }

  const startTime = Date.now()
  let chunkCount = 0
  let totalContent = ''
  let upstreamDone = false
  let clientDisconnected = false

  const apiReq = https.request(options, (apiRes) => {
    if (apiRes.statusCode !== 200) {
      let errBody = ''
      apiRes.on('data', c => { errBody += c })
      apiRes.on('end', () => {
        res.write('event: error\ndata: ' + JSON.stringify({ error: 'HTTP ' + apiRes.statusCode, detail: errBody.substring(0, 500) }) + '\n\n')
        res.end()
      })
      return
    }

    let buffer = ''
    apiRes.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const events = buffer.split('\n\n')
      buffer = events.pop()

      for (const evt of events) {
        const lines = evt.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const dataStr = line.substring(5).trim()
          if (dataStr === '[DONE]') {
            upstreamDone = true
            res.write('event: done\ndata: [DONE]\n\n')
            res.end()
            console.log('[ChatStream] done ' + (Date.now() - startTime) + 'ms ' + chunkCount + ' chunks ' + totalContent.length + ' chars')
            return
          }
          try {
            const parsed = JSON.parse(dataStr)
            const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta
            const content = (delta && delta.content) || ''
            if (content) {
              totalContent += content
              chunkCount++
              res.write('data: ' + JSON.stringify({ content, usage: parsed.usage || null }) + '\n\n')
            }
            const fr = parsed.choices && parsed.choices[0] && parsed.choices[0].finish_reason
            if (fr) {
              res.write('event: finish\ndata: ' + JSON.stringify({ finish_reason: fr }) + '\n\n')
            }
          } catch (e) {}
        }
      }
    })

    apiRes.on('end', () => {
      if (!res.writableEnded) {
        if (!upstreamDone) {
          res.write('event: error\ndata: ' + JSON.stringify({ error: '上游流式响应未正常完成' }) + '\n\n')
        } else {
          res.write('event: done\ndata: [DONE]\n\n')
        }
        res.end()
        console.log('[ChatStream] end ' + (Date.now() - startTime) + 'ms')
      }
    })

    apiRes.on('error', (err) => {
      console.error('[ChatStream] api error:', err.message)
      if (!res.writableEnded) {
        res.write('event: error\ndata: ' + JSON.stringify({ error: '上游流式连接异常' }) + '\n\n')
        res.end()
      }
    })
  })

  apiReq.on('error', (err) => {
    console.error('[ChatStream] req error:', err.message)
    if (!res.writableEnded) {
      res.write('event: error\ndata: ' + JSON.stringify({ error: '无法连接上游模型服务' }) + '\n\n')
      res.end()
    }
  })

  apiReq.on('timeout', () => {
    console.error('[ChatStream] timeout')
    apiReq.destroy()
    if (!res.writableEnded) {
      res.write('event: error\ndata: ' + JSON.stringify({ error: 'timeout' }) + '\n\n')
      res.end()
    }
  })

  res.on('close', () => {
    if (!res.writableEnded && !clientDisconnected) {
      clientDisconnected = true
      apiReq.destroy()
      console.log('[ChatStream] client disconnected')
    }
  })

  apiReq.write(postData)
  apiReq.end()
})

module.exports = router
