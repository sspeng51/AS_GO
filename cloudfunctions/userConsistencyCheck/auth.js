const crypto = require('crypto')

function safeEqual(actual, expected) {
  if (typeof expected !== 'string' || expected.length < 32 || !actual) return false
  const left = Buffer.from(String(actual))
  const right = Buffer.from(expected)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function isAuthorizedInvocation(event, openid, expectedSecret) {
  const isTrustedTimer = !openid && event && String(event.Type || '').toLowerCase() === 'timer' && Boolean(event.Time)
  return isTrustedTimer || safeEqual(event && event.adminSecret, expectedSecret)
}

module.exports = { safeEqual, isAuthorizedInvocation }
