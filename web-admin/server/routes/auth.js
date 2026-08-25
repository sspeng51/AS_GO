const express = require('express')
const bcrypt = require('bcryptjs')
const { generateToken, authMiddleware, requireAdmin } = require('../middleware/auth')
const { getDB, getDBOrNull, getStatus, COLLECTIONS } = require('../utils/cloudbase')

const router = express.Router()

function hasValidStandaloneAdmin() {
  return /^[A-Za-z0-9_.-]{3,32}$/.test(process.env.ADMIN_USERNAME || '') &&
    String(process.env.ADMIN_PASSWORD || '').length >= 12 &&
    !/please-change|change.?me|example|default/i.test(process.env.ADMIN_PASSWORD || '')
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    if (username.length > 32 || password.length > 128) {
      return res.status(400).json({ error: '用户名或密码格式不正确' })
    }

    const adminUsername = process.env.ADMIN_USERNAME
    const adminPassword = process.env.ADMIN_PASSWORD

    const db = getDBOrNull()

    let user = null
    if (db) {
      try {
        const userRes = await db.collection(COLLECTIONS.USERS)
          .where({ username })
          .limit(1)
          .get()

        if (userRes.data && userRes.data.length > 0) {
          user = userRes.data[0]
        }
      } catch (dbErr) {
        console.warn('[Auth] 数据库查询失败，使用默认管理员:', dbErr.message)
      }
    } else {
      console.warn('[Auth] CloudBase 未连接，使用内置管理员账号')
    }

    if (user) {
      if (user.status && user.status !== 'active') {
        return res.status(403).json({ error: '账号已停用' })
      }
      if (typeof user.password !== 'string' || !/^\$2[aby]\$/.test(user.password)) {
        return res.status(401).json({ error: '用户名或密码错误' })
      }
      const valid = await bcrypt.compare(password, user.password)
      if (!valid) {
        return res.status(401).json({ error: '用户名或密码错误' })
      }

      const token = generateToken({
        id: user._id,
        username: user.username,
        role: user.role === 'admin' ? 'admin' : 'viewer'
      })

      return res.json({
        success: true,
        token,
        user: {
          id: user._id,
          username: user.username,
          role: user.role === 'admin' ? 'admin' : 'viewer',
          nickname: user.nickname || user.username
        }
      })
    }

    if (hasValidStandaloneAdmin() && username === adminUsername && password === adminPassword) {
      const token = generateToken({
        id: 'admin-default',
        username: adminUsername,
        role: 'admin'
      })

      return res.json({
        success: true,
        token,
        user: {
          id: 'admin-default',
          username: adminUsername,
          role: 'admin',
          nickname: '系统管理员'
        }
      })
    }

    return res.status(401).json({ error: '用户名或密码错误' })
  } catch (err) {
    console.error('[Auth] 登录失败:', err.message)
    res.status(500).json({ error: '服务器内部错误' })
  }
})

router.get('/me', authMiddleware, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role
    }
  })
})

router.get('/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const db = getDB()
    const usersRes = await db.collection(COLLECTIONS.USERS)
      .where({ role: db.command.in(['admin', 'viewer']) })
      .limit(100)
      .get()

    res.json({
      success: true,
      users: (usersRes.data || [])
        .filter(u => u.username && ['admin', 'viewer'].includes(u.role))
        .map(u => ({
          id: u._id,
          username: u.username,
          role: u.role,
          status: u.status || 'active',
          nickname: u.nickname || u.username,
          createdAt: u.createdAt
        }))
    })
  } catch (err) {
    res.json({ success: true, users: [], warning: '用户数据库查询失败' })
  }
})

router.post('/register', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { username, password, nickname, role } = req.body

    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
      return res.status(400).json({ error: '用户名需为 3-32 位字母、数字或 _.-' })
    }
    if (password.length < 12 || password.length > 72) {
      return res.status(400).json({ error: '密码长度应为 12-72 位' })
    }
    if (role && !['admin', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'role 只能是 admin 或 viewer' })
    }

    const db = getDB()

    const existing = await db.collection(COLLECTIONS.USERS)
      .where({ username })
      .count()

    if (existing.total > 0) {
      return res.status(409).json({ error: '用户名已存在' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    await db.collection(COLLECTIONS.USERS).add({
      username,
      password: hashedPassword,
      nickname: nickname || username,
      role: role === 'admin' ? 'admin' : 'viewer',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    })

    res.json({ success: true, message: '用户创建成功' })
  } catch (err) {
    console.error('[Auth] 注册失败:', err.message)
    res.status(500).json({ error: '创建用户失败: ' + err.message })
  }
})

router.get('/status', (req, res) => {
  const status = getStatus()
  const hasAdminEnv = hasValidStandaloneAdmin()
  res.json({
    success: true,
    auth: {
      method: 'JWT Bearer Token',
      standalone: !status.ready,
      standaloneEnabled: hasAdminEnv,
      defaultAdmin: {
        username: hasAdminEnv ? '(configured)' : '(not configured)',
        enabled: hasAdminEnv
      }
    },
    cloudbase: {
      ready: status.ready,
      initialized: status.initialized,
      hasError: status.hasError
    },
    message: status.ready
      ? '系统正常运行，CloudBase 已连接'
      : (hasAdminEnv
        ? 'CloudBase 未连接，可使用环境变量配置的管理员账号登录'
        : 'CloudBase 未连接且独立管理员配置无效，请配置合法用户名和至少 12 位密码')
  })
})

module.exports = router
