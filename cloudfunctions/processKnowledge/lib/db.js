/**
 * 数据库初始化与通用工具
 *
 * - cloud.init 在模块加载时执行一次（云函数实例复用）
 * - 暴露 db / _ / $ / cloud 供各 handler 复用
 * - 提供集合操作通用工具：ensureCollection / batchInsert / isCollectionNotExistError
 */

const cloud = require('wx-server-sdk')
const config = require('../config')

cloud.init({ env: config.cloud?.envId || 'cloud1-6gbzplmt4a3dc5b5' })

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

// 集合名常量（统一管理，避免散落字符串）
const COLLECTIONS = {
  CONVERSATIONS: 'conversations',
  USERS: 'users',
  AI_USAGE: 'ai_usage',
  // 个人知识库三张表
  PERSONAL_DOCS: 'personal_kb_documents',    // 文档元数据
  PERSONAL_CHUNKS: 'personal_kb_chunks',      // 文档切片 + 向量
  PERSONAL_HISTORY: 'personal_kb_history'     // 问答历史
}

// 个人知识库：单次检索扫描的切片上限（性能与召回平衡）
// 超过此值的用户建议 Phase 3 升级 ANN/专用向量库
const PERSONAL_SEARCH_CHUNK_CAP = 300
// 单文档最大切片数（防超大文件拖垮嵌入成本）
const PERSONAL_MAX_CHUNKS_PER_DOC = 200

/**
 * 确保集合存在（幂等，已存在则忽略）
 */
async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (e) { /* 已存在则忽略 */ }
}

/**
 * 批量插入（分批并发，避免单次过大）
 */
async function batchInsert(collectionName, docs, batchSize = 20) {
  const saved = []
  const failures = []
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map(doc => db.collection(collectionName).add({ data: doc }))
    )
    results.forEach((r, index) => {
      if (r.status === 'fulfilled') saved.push(r.value._id)
      else failures.push({
        index: i + index,
        message: r.reason && r.reason.message ? r.reason.message : String(r.reason || '写入失败')
      })
    })
  }
  if (failures.length > 0) {
    const error = new Error(`批量写入不完整：成功 ${saved.length} 条，失败 ${failures.length} 条`)
    error.code = 'BATCH_INSERT_PARTIAL_FAILURE'
    error.savedIds = saved
    error.failures = failures.slice(0, 5)
    throw error
  }
  return saved
}

/**
 * 判断是否为"集合不存在"错误（兼容字符串/数字/消息体三种形态）
 */
function isCollectionNotExistError(e) {
  if (!e) return false
  // 字符串 code
  if (e.code === 'DATABASE_COLLECTION_NOT_EXIST') return true
  // 数字 code（CloudBase 运行时常以此形态出现）
  if (e.code === -502005 || e.errCode === -502005) return true
  // 消息体兜底
  const msg = (e.message || '') + ' ' + (e.errMsg || '')
  if (msg.includes('DATABASE_COLLECTION_NOT_EXIST')) return true
  if (msg.includes('not exist') || msg.includes('notexist')) return true
  return false
}

/**
 * 安全写入单条文档：集合不存在时自动创建后重试一次
 * 消除各 handler 中重复的 try/catch + createCollection + 重试逻辑
 * @param {string} collectionName 集合名
 * @param {object} doc 文档数据
 * @returns {Promise<{_id}>} 插入结果
 */
async function safeAdd(collectionName, doc) {
  try {
    return await db.collection(collectionName).add({ data: doc })
  } catch (e) {
    if (isCollectionNotExistError(e)) {
      await ensureCollection(collectionName)
      return await db.collection(collectionName).add({ data: doc })
    }
    throw e
  }
}

/**
 * 用户身份脱敏（日志安全）：仅保留前 8 位 + ...
 * @param {string} id 完整 OPENID / userId
 * @returns {string} 脱敏后的字符串
 */
function maskId(id) {
  if (!id || typeof id !== 'string') return 'empty'
  return id.length > 8 ? id.substring(0, 8) + '...' : id
}

module.exports = {
  cloud,
  db,
  _,
  $,
  COLLECTIONS,
  PERSONAL_SEARCH_CHUNK_CAP,
  PERSONAL_MAX_CHUNKS_PER_DOC,
  ensureCollection,
  batchInsert,
  isCollectionNotExistError,
  safeAdd,
  maskId
}
