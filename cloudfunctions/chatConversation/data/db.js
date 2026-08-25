/**
 * 数据库操作层
 * 封装所有与 conversations 集合的交互，统一错误处理
 */

const logger = require('../utils/logger')

const COLLECTION_NAME = 'conversations'
const MAX_FETCH_LIMIT = 1000

let db = null
let _ = null

/**
 * 初始化数据库连接
 */
function init(database, command) {
  db = database
  _ = command
  logger.info('DB', '数据库层已初始化')
}

/**
 * 获取数据库实例
 */
function getDB() {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 init()')
  }
  return db
}

/**
 * 获取数据库命令引用
 */
function getCommand() {
  if (!_) {
    throw new Error('数据库未初始化，请先调用 init()')
  }
  return _
}

/**
 * 获取集合引用
 */
function collection() {
  return getDB().collection(COLLECTION_NAME)
}

// ==================== 写入操作 ====================

/**
 * 保存一条对话消息
 */
async function insertMessage(messageRecord) {
  const startTime = Date.now()
  try {
    await collection().add({ data: messageRecord })
    const elapsed = Date.now() - startTime
    logger.info('DB', `消息写入成功: ${messageRecord._id}`, { elapsed: `${elapsed}ms`, userId: messageRecord.userId })
    return { success: true, messageId: messageRecord._id }
  } catch (err) {
    logger.error('DB', '消息写入失败', { error: err.message, userId: messageRecord.userId })
    throw new Error(`数据库写入失败: ${err.message}`)
  }
}

// ==================== 查询操作 ====================

/**
 * 查询消息列表（按 userId + sessionId）
 */
async function findMessages(whereCondition, { skip = 0, limit = 50 } = {}) {
  const startTime = Date.now()
  const safeLimit = Math.min(limit, MAX_FETCH_LIMIT)

  try {
    const countRes = await collection().where(whereCondition).count()
    const total = countRes.total || 0

    const listRes = await collection()
      .where(whereCondition)
      .orderBy('timestamp', 'asc')
      .skip(skip)
      .limit(safeLimit)
      .get()

    const elapsed = Date.now() - startTime
    logger.info('DB', `消息查询完成`, { total, returned: (listRes.data || []).length, elapsed: `${elapsed}ms` })

    return {
      messages: listRes.data || [],
      total
    }
  } catch (err) {
    logger.error('DB', '消息查询失败', { error: err.message, whereCondition })
    throw new Error(`消息查询失败: ${err.message}`)
  }
}

/**
 * 查询有对话记录的用户列表
 */
async function findActiveUsers() {
  const startTime = Date.now()
  try {
    const listRes = await collection()
      .field({ userId: true, timestamp: true, metadata: true })
      .orderBy('timestamp', 'desc')
      .limit(MAX_FETCH_LIMIT)
      .get()

    const messages = listRes.data || []
    const userMap = new Map()

    for (const msg of messages) {
      if (!userMap.has(msg.userId)) {
        const meta = msg.metadata || {}
        userMap.set(msg.userId, {
          userId: msg.userId,
          lastActiveTime: msg.timestamp,
          nickName: meta.nickName || '',
          avatarUrl: meta.avatarUrl || ''
        })
      }
    }

    const users = [...userMap.values()]
    users.sort((a, b) => new Date(b.lastActiveTime) - new Date(a.lastActiveTime))

    const elapsed = Date.now() - startTime
    logger.info('DB', `活跃用户查询完成`, { count: users.length, elapsed: `${elapsed}ms` })

    return users
  } catch (err) {
    logger.error('DB', '活跃用户查询失败', { error: err.message })
    throw new Error(`用户查询失败: ${err.message}`)
  }
}

/**
 * 查询最近的对话消息（用于聚合会话）
 */
async function findRecentMessages(whereCondition = {}, limit = MAX_FETCH_LIMIT) {
  const startTime = Date.now()
  try {
    const listRes = await collection()
      .where(whereCondition)
      .orderBy('timestamp', 'desc')
      .limit(Math.min(limit, MAX_FETCH_LIMIT))
      .get()

    const elapsed = Date.now() - startTime
    logger.info('DB', `会话聚合查询完成`, { returned: (listRes.data || []).length, elapsed: `${elapsed}ms` })

    return listRes.data || []
  } catch (err) {
    logger.error('DB', '会话聚合查询失败', { error: err.message })
    throw new Error(`会话查询失败: ${err.message}`)
  }
}

// ==================== 删除操作 ====================

/**
 * 删除指定会话的全部消息
 */
async function deleteSessionMessages(userId, sessionId) {
  const startTime = Date.now()
  try {
    // 先统计
    const countRes = await collection()
      .where({ userId, sessionId })
      .count()

    const total = countRes.total || 0

    if (total === 0) {
      logger.info('DB', '会话删除: 无消息可删除', { userId, sessionId })
      return { deletedCount: 0 }
    }

    // 批量删除（CloudBase 一次最多删除 1000 条）
    const removed = await collection()
      .where({ userId, sessionId })
      .remove()

    const deletedCount = removed.stats?.removed || removed.deleted || 0
    const elapsed = Date.now() - startTime

    logger.info('DB', '会话删除完成', { userId, sessionId, total, deletedCount, elapsed: `${elapsed}ms` })

    return { deletedCount }
  } catch (err) {
    logger.error('DB', '会话删除失败', { error: err.message, userId, sessionId })
    throw new Error(`会话删除失败: ${err.message}`)
  }
}

module.exports = {
  init,
  getCommand,
  COLLECTION_NAME,
  insertMessage,
  findMessages,
  findActiveUsers,
  findRecentMessages,
  deleteSessionMessages
}