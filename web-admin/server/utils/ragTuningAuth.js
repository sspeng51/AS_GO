const crypto = require('crypto')
function validKnowledgeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}
function signTuningRequest(payload, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) throw Object.assign(new Error('切换知识库需要在后台与云函数配置相同的 RAG_TUNING_SHARED_SECRET（至少 32 字符），也可复用已有 STREAM_SHARED_SECRET'), { status: 503 })
  const expiresAt = now + 90000
  // Cloud transports can reserialize JSON objects with alphabetically ordered
  // keys. Sign and send the same stable representation, not insertion order.
  payload = Object.fromEntries(Object.keys(payload).sort().map(key => [key, payload[key]]))
  const signature = crypto.createHmac('sha256', secret).update(`rag-tuning-search:v1\n${expiresAt}\n${JSON.stringify(payload)}`).digest('hex')
  return { payload, expiresAt, signature }
}
module.exports = { signTuningRequest, validKnowledgeId }
