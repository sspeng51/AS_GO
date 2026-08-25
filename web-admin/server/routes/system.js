const express = require('express')
const { getDB, getDBOrNull, COLLECTIONS, getStatus, isReady } = require('../utils/cloudbase')
const { authMiddleware, requireAdmin, requireStaff } = require('../middleware/auth')

const router = express.Router()

router.use(authMiddleware, requireStaff)

// GET /system/config — 系统配置（只读展示，项目已切换智谱托管知识库，自建 RAG 配置已移除）
router.get('/config', async (req, res) => {
  try {
    const systemConfig = {
      environment: {
        envId: process.env.CLOUDBASE_ENV_ID || 'cloud1-6gbzplmt4a3dc5b5',
        region: 'ap-shanghai'
      },
      zhipu: {
        // 模型从环境变量读取，兜底与主配置 config/config.js 保持一致
        model: process.env.ZHIPU_MODEL || 'glm-5.2',
        embeddingModel: 'embedding-3',
        knowledgeId: process.env.ZHIPU_KNOWLEDGE_ID ? process.env.ZHIPU_KNOWLEDGE_ID.substring(0, 8) + '...' : '未配置',
        apiKeyConfigured: !!process.env.ZHIPU_API_KEY || !!process.env.BIGMODEL_API_KEY
      },
      cloudFunction: {
        name: 'processKnowledge',
        version: '2.2.0',
        timeout: 120,
        memorySize: 512
      }
    }

    res.json({ success: true, config: systemConfig })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /system/cloudbase-diag — CloudBase 连接诊断
router.get('/cloudbase-diag', requireAdmin, async (req, res) => {
  try {
    const status = getStatus()
    const db = getDBOrNull()

    let testResult = null
    if (db && status.ready) {
      try {
        const testDoc = await db.collection(COLLECTIONS.USERS).limit(1).get()
        testResult = {
          success: true,
          message: '数据库连接正常',
          dataCount: testDoc.data?.length || 0
        }
      } catch (testErr) {
        testResult = {
          success: false,
          message: testErr.message,
          code: testErr.code || 'UNKNOWN'
        }
      }
    }

    res.json({
      success: true,
      diagnosis: {
        ...status,
        hasSecretId: !!process.env.CLOUDBASE_SECRET_ID,
        hasSecretKey: !!process.env.CLOUDBASE_SECRET_KEY,
        secretIdPrefix: process.env.CLOUDBASE_SECRET_ID?.substring(0, 8) + '...',
        testConnection: testResult
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /system/collections — 检查业务集合状态
router.get('/collections', async (req, res) => {
  try {
    const db = getDBOrNull()
    const collections = ['users', 'rag_config', 'conversations', 'feedback']
    const result = []

    if (!db) {
      return res.json({ success: false, error: '数据库未初始化' })
    }

    for (const name of collections) {
      try {
        const count = await db.collection(name).count()
        result.push({ name, exists: true, total: count.total })
      } catch (err) {
        result.push({ name, exists: false, total: 0, error: err.code || err.message?.substring(0, 80) })
      }
    }

    res.json({ success: true, collections: result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
