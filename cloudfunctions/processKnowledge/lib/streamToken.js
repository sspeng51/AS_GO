const crypto = require('crypto')

function encode(value) {
  return Buffer.from(value).toString('base64url')
}

function createStreamToken(secret, subject, ttlSeconds = 120) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('STREAM_SHARED_SECRET 未配置或长度不足 32 位')
  }
  const now = Math.floor(Date.now() / 1000)
  const payload = encode(JSON.stringify({
    sub: String(subject),
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomBytes(16).toString('hex')
  }))
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

module.exports = { createStreamToken }
