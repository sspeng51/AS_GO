const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })

const { initCloudBase, getStatus } = require('./utils/cloudbase')
const { isValidJwtSecret } = require('./middleware/auth')

const authRoutes = require('./routes/auth')
const systemRoutes = require('./routes/system')
const conversationRoutes = require('./routes/conversations')
const feedbackRoutes = require('./routes/feedback')
const wechatRoutes = require('./routes/wechat')
const ragConfigRoutes = require('./routes/ragConfig')
const chatStreamRoutes = require('./routes/chatStream')

const app = express()
const PORT = process.env.PORT || 3000

app.set('trust proxy', 1)

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || [
      'http://localhost:5173', 'http://127.0.0.1:5173',
      'http://localhost:3000', 'http://127.0.0.1:3000'
    ].join(',')).split(',').map(item => item.trim()).filter(Boolean)
    // 允许白名单内 origin；同源请求（无 origin 头）放行；其余拒绝
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('CORS policy: origin not allowed'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

app.use(morgan('short'))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: '请求过于频繁，请稍后再试' }
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: '登录尝试过于频繁，请15分钟后再试' }
})

const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: { error: '对话请求过于频繁，请稍后再试' }
})

app.use('/api/', generalLimiter)
app.use('/api/auth/login', authLimiter)
app.use('/api/wechat/login', authLimiter)
app.use('/api/chat/stream', chatLimiter)

app.use('/api/auth', authRoutes)
app.use('/api/system', systemRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/feedback', feedbackRoutes)
app.use('/api/wechat', wechatRoutes)
app.use('/api/rag-config', ragConfigRoutes)
app.use('/api/rag-tuning', require('./routes/ragTuning'))
app.use('/api/chat', chatStreamRoutes)

app.get('/api/health', (req, res) => {
  const { isReady, getStatus } = require('./utils/cloudbase')
  const status = getStatus()
  res.json({
    status: 'ok',
    database: status.ready ? 'connected' : 'disconnected',
    auth: status.ready ? 'cloudbase' : 'standalone',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: {
      node: process.version,
      port: PORT,
      envId: process.env.NODE_ENV === 'production'
        ? (process.env.CLOUDBASE_ENV_ID ? 'configured' : 'not-set')
        : (process.env.CLOUDBASE_ENV_ID || 'not-set')
    }
  })
})

app.use((err, req, res, next) => {
  console.error('[ServerError]', err.message)
  if (process.env.NODE_ENV !== 'production') console.error(err.stack)

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '请求体过大，请减少上传内容' })
  }
  if (/CORS policy/i.test(err.message || '')) {
    return res.status(403).json({ error: '请求来源不在允许列表中' })
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? '服务器内部错误'
      : err.message
  })
})

async function start() {
  console.log(`\n=========================================`)
  console.log(` 砷智答知识库管理后台 - 启动中...`)
  console.log(` 环境: ${process.env.CLOUDBASE_ENV_ID || '未配置'}`)
  console.log(`=========================================`)
  if (!isValidJwtSecret(process.env.JWT_SECRET)) {
    throw new Error('JWT_SECRET 未配置、过弱或仍为示例值，拒绝启动')
  }
  
  try {
    await initCloudBase()
    const status = getStatus()
    if (status.ready) {
      console.log('[Server] ✅ CloudBase 连接成功')
      console.log(`[Server] 📡 环境ID: ${status.verifiedEnvId || process.env.CLOUDBASE_ENV_ID}`)
    } else {
      console.warn(`[Server] ⚠️ CloudBase 连接失败: ${status.error || '未知原因'}`)
      console.warn('[Server] 数据库功能不可用，需配置 .env 中的 CLOUDBASE_SECRET_ID/SECRET_KEY 或 CLOUDBASE_ACCESS_KEY')
      console.warn('[Server] 获取方式: https://console.cloud.tencent.com/cam/capi')
    }
  } catch (err) {
    console.warn(`[Server] ⚠️ CloudBase 连接失败: ${err.message}`)
    console.warn('[Server] 数据库功能不可用，需配置 .env 中的 CLOUDBASE_SECRET_ID/SECRET_KEY')
    console.warn('[Server] 获取方式: https://console.cloud.tencent.com/cam/capi')
  }

  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n=========================================`)
      console.log(` 🚀 后端服务已启动`)
      console.log(` 🌐 地址: http://localhost:${PORT}`)
      console.log(` 🔑 API:  http://localhost:${PORT}/api`)
      console.log(` 💚 健康: http://localhost:${PORT}/api/health`)
      console.log(`=========================================\n`)
      resolve()
    })
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${PORT} 已被占用，请关闭旧实例或修改 PORT`))
      } else {
        reject(error)
      }
    })
  })
}

start().catch(err => {
  console.error(`[Server] 启动失败: ${err.message}`)
  process.exitCode = 1
})

module.exports = app
