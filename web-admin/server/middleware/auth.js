const jwt = require('jsonwebtoken')

// 安全提示：不再提供硬编码兜底值，必须通过环境变量配置高强度随机字符串
const JWT_SECRET = process.env.JWT_SECRET

function isValidJwtSecret(secret) {
  return typeof secret === 'string' &&
    secret.length >= 32 &&
    !/please-change|change.?me|your-|example|default|secret$/i.test(secret)
}

if (!isValidJwtSecret(JWT_SECRET)) {
  console.error('[Auth] 严重：JWT_SECRET 未配置、过弱或仍为示例值，请设置至少 32 位随机字符串')
}

// 运行时校验：若未配置则拒绝签发/验证 token，避免使用弱密钥
function getSecret() {
  if (!isValidJwtSecret(JWT_SECRET)) {
    const err = new Error('JWT_SECRET 未正确配置，服务不可用')
    err.code = 'JWT_NOT_CONFIGURED'
    throw err
  }
  return JWT_SECRET
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, getSecret())
    req.user = decoded
    next()
  } catch (err) {
    if (err.code === 'JWT_NOT_CONFIGURED') {
      return res.status(503).json({ error: '服务未正确配置认证密钥' })
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '令牌已过期，请重新登录' })
    }
    return res.status(401).json({ error: '无效的认证令牌' })
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], getSecret())
      req.user = decoded
    } catch (e) {}
  }
  next()
}

function generateToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, getSecret(), { expiresIn })
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' })
  }
  next()
}

function requireStaff(req, res, next) {
  if (!req.user || !['admin', 'viewer'].includes(req.user.role)) {
    return res.status(403).json({ error: '需要后台工作人员权限' })
  }
  next()
}

module.exports = {
  authMiddleware,
  optionalAuth,
  generateToken,
  requireAdmin,
  requireStaff,
  isValidJwtSecret,
  JWT_SECRET
}
