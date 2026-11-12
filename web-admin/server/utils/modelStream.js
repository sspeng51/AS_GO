const { StringDecoder } = require('string_decoder')

// A bounded suffix check avoids spending the entire deadline on a model loop.
function repeatedSuffix(text) {
  const tail = text.slice(-4096)
  for (let size = 1; size <= 80; size++) {
    const unit = tail.slice(-size)
    if (!/\p{L}/u.test(unit)) continue
    const count = Math.max(32, Math.ceil(256 / size))
    if (tail.endsWith(unit.repeat(count))) return true
  }
  return false
}

// Read SSE incrementally; never accept an interrupted answer as a completed answer.
async function readModelStream(stream, onProgress = async () => {}, started = Date.now()) {
  const decoder = new StringDecoder('utf8')
  let buffer = '', answer = '', usage = null, finishReason = null, done = false, reasoningChars = 0
  let firstTokenMs = null
  function event(block) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim()
    if (!data) return
    if (data === '[DONE]') { done = true; return }
    const value = JSON.parse(data)
    if (value.error) throw Object.assign(new Error('模型流返回错误'), { response: { status: 400, data: { error: value.error } } })
    const choice = value.choices?.[0], delta = choice?.delta || {}
    if ((delta.content || delta.reasoning_content) && firstTokenMs === null) firstTokenMs = Date.now() - started
    if (typeof delta.content === 'string') answer += delta.content
    if (typeof delta.content === 'string' && repeatedSuffix(answer)) throw Object.assign(new Error('模型重复输出异常，已停止请求并保留完整评分；请继续补评缺失项'), { status: 502, code: 'MODEL_REPETITION' })
    if (typeof delta.reasoning_content === 'string') reasoningChars += delta.reasoning_content.length
    if (value.usage) usage = value.usage
    if (choice?.finish_reason) finishReason = choice.finish_reason
    if (answer.length > 2000000) throw new Error('模型输出超过安全长度')
  }
  try {
    for await (const chunk of stream) {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk)
      let match
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length)
      }
      if (buffer.length > 2000000) throw new Error('模型流事件超过安全长度')
      await onProgress({ answerChars: answer.length, reasoningChars, firstTokenMs, receivedAt: new Date().toISOString() })
      if (done) break
    }
    buffer += decoder.end()
    if (buffer.trim() && !done) event(buffer)
    if (!finishReason) throw Object.assign(new Error('模型输出中断，已保留片段；请重试未完成阶段'), { status: 502 })
    if (!answer.trim()) throw Object.assign(new Error('模型未返回正文，可能输出预算被思考耗尽；请检查输出Token上限'), { status: 502 })
    return { answer, usage, finishReason, firstTokenMs, reasoningChars }
  } catch (error) {
    error.partialAnswer = answer
    error.streamUsage = usage
    throw error
  }
}

async function streamingCompletion(axios, key, payload, settings) {
  const started = Date.now()
  const controller = new AbortController()
  const totalMs = settings.requestTimeoutMs || 240000
  let response, deadlineExpired = false
  const timer = setTimeout(() => { deadlineExpired = true; controller.abort() }, totalMs)
  timer.unref?.()
  try {
    response = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', { ...payload, stream: true }, {
      headers: { Authorization: `Bearer ${key}` }, responseType: 'stream',
      timeout: Math.min(90000, totalMs), signal: controller.signal
    })
    // Inactivity timeout is separate from the hard total deadline.
    response.data.setTimeout?.(60000, () => response.data.destroy(Object.assign(new Error('stream idle'), { code: 'ETIMEDOUT' })))
    return await readModelStream(response.data, settings.onProgress, started)
  } catch (error) {
    if (deadlineExpired) error.code = 'ETIMEDOUT'
    error.timeoutMs = deadlineExpired ? totalMs : response ? 60000 : Math.min(90000, totalMs)
    if (error.response?.data?.[Symbol.asyncIterator]) {
      let body = ''
      try { for await (const chunk of error.response.data) { body += chunk.toString(); if (body.length > 8192) break } error.response.data = JSON.parse(body) } catch { error.response.data = {} }
    }
    throw error
  } finally { clearTimeout(timer); response?.data?.destroy?.() }
}
module.exports = { readModelStream, streamingCompletion }
