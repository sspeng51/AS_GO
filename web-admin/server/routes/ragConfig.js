const express = require('express')
const { getDB } = require('../utils/cloudbase')
const { authMiddleware, requireAdmin, requireStaff } = require('../middleware/auth')

const router = express.Router()
router.use(authMiddleware, requireStaff)

const COLLECTION_NAME = 'rag_config'
const DOC_ID = 'current'

// 确保集合存在（doc(id).set() 不会自动创建集合，需显式创建）
// 使用函数声明以便提升，避免调用时未定义
async function ensureCollection(db) {
  try {
    await db.createCollection(COLLECTION_NAME)
  } catch (e) {
    // 集合已存在或权限不足，忽略错误
  }
}

// 默认 RAG 配置（与云函数/前端硬编码默认值保持一致，作为 fallback）
// 项目已切换为智谱托管知识库，仅保留 zhipu + context 两组配置
const DEFAULT_RAG_CONFIG = {
  preset: 'balanced',
  zhipu: {
    useZhipuKb: true,      // 是否走智谱托管知识库
    topN: 15,              // 智谱初始召回数
    cloudTimeout: 15000   // 客户端超时(ms)
  },
  retrieval: {
    recallMethod: 'mixed', // 召回方式：mixed(混合) | embedding(向量) | keyword(关键词)
    recallRatio: 80,       // 向量召回占比(0-100)，仅 mixed 模式生效
    rerankStatus: 0        // 智谱重排开关：0 关闭 | 1 开启
  },
  context: {
    maxChunks: 10,          // 送入 LLM 的最大分块数
    maxTokens: 2000,       // 上下文 token 预算
    minScore: 40,          // 最低相关度分（0-100）
    overlap: 200,          // 分块重叠字符数
    includeMetadata: true  // 是否在上下文中携带来源元数据
  },
  graph: {
    enabled: true,
    hybridTimeout: 85000,
    plannerTimeout: 12000,
    queryTimeout: 15000,
    maxHops: 2,
    maxFacts: 20,
    contextMaxTokens: 800,
    schemaCacheTTL: 600000
  }
}

// 预设档：一键应用一组参数（覆盖 zhipu + retrieval + context）
const PRESETS = {
  precise: {
    zhipu: { useZhipuKb: true, topN: 10, cloudTimeout: 12000 },
    retrieval: { recallMethod: 'mixed', recallRatio: 70, rerankStatus: 1 },
    context: { maxChunks: 3, maxTokens: 1500, minScore: 50, overlap: 150, includeMetadata: true },
    graph: { ...DEFAULT_RAG_CONFIG.graph, maxFacts: 8, contextMaxTokens: 600 }
  },
  balanced: null, // 等价于 DEFAULT_RAG_CONFIG
  recall: {
    zhipu: { useZhipuKb: true, topN: 25, cloudTimeout: 20000 },
    retrieval: { recallMethod: 'mixed', recallRatio: 90, rerankStatus: 0 },
    context: { maxChunks: 8, maxTokens: 3000, minScore: 20, overlap: 250, includeMetadata: true },
    graph: { ...DEFAULT_RAG_CONFIG.graph, maxFacts: 20, contextMaxTokens: 1200 }
  }
}

// 深合并 saved 与 DEFAULT，确保新字段有默认值
function mergeConfig(saved) {
  const result = JSON.parse(JSON.stringify(DEFAULT_RAG_CONFIG))
  if (!saved) return result
  for (const section of Object.keys(result)) {
    if (saved[section] && typeof saved[section] === 'object') {
      // 仅保留当前问答链路已定义的字段，避免旧版 UI 写入的无效参数
      // （如 maxContextChars）继续被保存和下发，造成“调了却不生效”。
      const allowed = Object.keys(result[section])
      for (const key of allowed) {
        if (saved[section][key] !== undefined) {
          result[section][key] = saved[section][key]
        }
      }
    } else if (saved[section] !== undefined) {
      result[section] = saved[section]
    }
  }
  return result
}

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return '配置不能为空'
  const z = cfg.zhipu || {}
  if (z.useZhipuKb !== undefined && typeof z.useZhipuKb !== 'boolean') return 'useZhipuKb 必须为布尔值'
  if (z.topN !== undefined && (z.topN < 1 || z.topN > 50)) return 'topN 范围 1-50'
  if (z.cloudTimeout !== undefined && (z.cloudTimeout < 5000 || z.cloudTimeout > 120000)) return 'cloudTimeout 范围 5000-120000'
  if (z.rerank !== undefined && typeof z.rerank !== 'boolean') return 'rerank 必须为布尔值'
  const r = cfg.retrieval || {}
  if (r.recallMethod !== undefined && !['mixed', 'embedding', 'keyword'].includes(r.recallMethod)) return 'recallMethod 必须是 mixed/embedding/keyword'
  if (r.recallRatio !== undefined && (r.recallRatio < 0 || r.recallRatio > 100)) return 'recallRatio 范围 0-100'
  if (r.rerankStatus !== undefined && ![0, 1].includes(r.rerankStatus)) return 'rerankStatus 必须是 0 或 1'
  const c = cfg.context || {}
  if (c.maxChunks !== undefined && (c.maxChunks < 1 || c.maxChunks > 20)) return 'maxChunks 范围 1-20'
  if (c.maxTokens !== undefined && (c.maxTokens < 500 || c.maxTokens > 8000)) return 'maxTokens 范围 500-8000'
  if (c.minScore !== undefined && (c.minScore < 0 || c.minScore > 100)) return 'minScore 范围 0-100'
  const g = cfg.graph || {}
  if (g.enabled !== undefined && typeof g.enabled !== 'boolean') return 'graph.enabled 必须为布尔值'
  if (g.hybridTimeout !== undefined && (g.hybridTimeout < 10000 || g.hybridTimeout > 120000)) return 'hybridTimeout 范围 10000-120000'
  if (g.plannerTimeout !== undefined && (g.plannerTimeout < 3000 || g.plannerTimeout > 30000)) return 'plannerTimeout 范围 3000-30000'
  if (g.queryTimeout !== undefined && (g.queryTimeout < 1000 || g.queryTimeout > 30000)) return 'queryTimeout 范围 1000-30000'
  if (g.maxHops !== undefined && (g.maxHops < 1 || g.maxHops > 4)) return 'maxHops 范围 1-4'
  if (g.maxFacts !== undefined && (g.maxFacts < 1 || g.maxFacts > 20)) return 'maxFacts 范围 1-20'
  if (g.contextMaxTokens !== undefined && (g.contextMaxTokens < 100 || g.contextMaxTokens > 4000)) return 'contextMaxTokens 范围 100-4000'
  if (g.schemaCacheTTL !== undefined && (g.schemaCacheTTL < 60000 || g.schemaCacheTTL > 3600000)) return 'schemaCacheTTL 范围 60000-3600000'
  return null
}

// GET /rag-config — 读取当前配置（不存在则返回默认）
router.get('/', async (req, res) => {
  try {
    const db = getDB()
    let saved = null
    try {
      const doc = await db.collection(COLLECTION_NAME).doc(DOC_ID).get()
      saved = doc?.data || null
    } catch (e) { /* 文档不存在 */ }
    const config = mergeConfig(saved)
    res.json({ success: true, config })
  } catch (err) {
    // CloudBase 不可用时返回默认，保证 UI 可用
    const config = mergeConfig(null)
    res.json({ success: true, config, warning: '数据库不可用，返回默认配置' })
  }
})

// GET /rag-config/presets — 列出可选预设
router.get('/presets', (req, res) => {
  const list = Object.keys(PRESETS).map(name => ({
    name,
    label: name === 'precise' ? '精确模式' : name === 'balanced' ? '均衡模式' : '召回模式',
    desc: name === 'precise' ? '高阈值少结果，追求精准' : name === 'balanced' ? '默认推荐参数' : '低阈值多结果，追求召回',
    config: name === 'balanced' ? DEFAULT_RAG_CONFIG : { ...PRESETS[name], preset: name }
  }))
  res.json({ success: true, presets: list })
})

// PUT /rag-config — 更新配置（upsert）
router.put('/', requireAdmin, async (req, res) => {
  try {
    const incoming = req.body || {}
    const validationError = validateConfig(incoming)
    if (validationError) {
      return res.status(400).json({ error: validationError })
    }

    const db = getDB()
    await ensureCollection(db)
    const merged = mergeConfig(incoming)
    merged.updatedAt = new Date()
    merged.updatedBy = req.user?.username || 'system'

    // doc(id).set: 文档不存在则创建，存在则替换
    await db.collection(COLLECTION_NAME).doc(DOC_ID).set(merged)

    res.json({ success: true, config: merged })
  } catch (err) {
    console.error('[RagConfig] 保存失败:', err.message)
    res.status(500).json({ error: '保存失败: ' + err.message })
  }
})

// POST /rag-config/preset — 应用预设
router.post('/preset', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body || {}
    // 注意：PRESETS.balanced === null 是合法值，不能用 !PRESETS[name] 判断
    if (!(name in PRESETS)) {
      return res.status(400).json({ error: '未知预设: ' + name })
    }
    const db = getDB()
    await ensureCollection(db)
    const config = name === 'balanced'
      ? JSON.parse(JSON.stringify(DEFAULT_RAG_CONFIG))
      : { ...JSON.parse(JSON.stringify(PRESETS[name])), preset: name }
    config.updatedAt = new Date()
    config.updatedBy = req.user?.username || 'system'

    await db.collection(COLLECTION_NAME).doc(DOC_ID).set(config)
    res.json({ success: true, config })
  } catch (err) {
    res.status(500).json({ error: '应用预设失败: ' + err.message })
  }
})

module.exports = router
