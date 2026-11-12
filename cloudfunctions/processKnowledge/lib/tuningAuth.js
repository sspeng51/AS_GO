const crypto = require('crypto')
const PURPOSE = 'rag-tuning-search:v1'
function signature(payload, expiresAt, secret) {
  payload = Object.fromEntries(Object.keys(payload).sort().map(key => [key, payload[key]]))
  return crypto.createHmac('sha256', secret).update(`${PURPOSE}\n${expiresAt}\n${JSON.stringify(payload)}`).digest('hex')
}
function validKnowledgeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}
function verifyTuningRequest(request, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('后台知识库切换未配置共享签名密钥')
  const { payload, expiresAt, signature: actual } = request || {}
  if (payload?.retrievalMode !== undefined && !['knowledge', 'graph', 'hybrid'].includes(payload.retrievalMode)) throw new Error('调优检索模式无效')
  if (!payload || !validKnowledgeId(payload.knowledgeId) || typeof payload.query !== 'string' || !payload.query.trim() || payload.query.length > 1000 || !Number.isInteger(payload.topK) || payload.topK < 1 || payload.topK > 20) throw new Error('调优检索参数无效')
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + 120000 || typeof actual !== 'string' || !/^[a-f0-9]{64}$/.test(actual)) throw new Error('调优检索签名已失效')
  const expected = signature(payload, expiresAt, secret)
  if (!crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    // Accept legacy signatures during rollout without weakening payload binding.
    const legacy = crypto.createHmac('sha256', secret).update(`${PURPOSE}\n${expiresAt}\n${JSON.stringify(payload)}`).digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(legacy))) throw new Error('调优检索签名校验失败')
  }
  return payload
}
module.exports = { signature, verifyTuningRequest, validKnowledgeId }
