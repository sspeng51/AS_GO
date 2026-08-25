const crypto = require('crypto')

function verifyStreamToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('流式服务凭据未配置')
  if (typeof token !== 'string' || token.length > 2048) throw new Error('流式令牌无效')
  const parts = token.split('.')
  if (parts.length !== 2) throw new Error('流式令牌无效')

  const [payload, signature] = parts
  const expected = crypto.createHmac('sha256', secret).update(payload).digest()
  let actual
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch (e) {
    throw new Error('流式令牌无效')
  }
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('流式令牌无效')
  }

  let claims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch (e) {
    throw new Error('流式令牌无效')
  }
  if (!claims.sub || !claims.jti || !Number.isInteger(claims.exp) || claims.exp <= nowSeconds) {
    throw new Error('流式令牌已过期')
  }
  if (claims.exp - nowSeconds > 180) throw new Error('流式令牌有效期异常')
  return claims
}

module.exports = { verifyStreamToken }
