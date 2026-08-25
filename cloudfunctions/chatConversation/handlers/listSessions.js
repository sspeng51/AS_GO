/**
 * 查询会话列表处理器
 * 按 userId 聚合会话，返回每个会话的摘要信息
 */

const db = require('../data/db')
const logger = require('../utils/logger')
const response = require('../utils/response')
const validator = require('../utils/validator')

async function handle(params) {
  const MODULE = 'ListSessions'

  // 1. 参数验证
  const errors = validator.validateListSessions(params)
  if (errors.length > 0) {
    logger.warn(MODULE, '参数验证失败', errors)
    return response.validationError(errors)
  }

  const userId = params.userId ? params.userId.trim() : null
  const page = parseInt(params.page) || 1
  const pageSize = Math.min(parseInt(params.pageSize) || 20, validator.MAX_PAGE_SIZE)

  logger.info(MODULE, '开始查询会话', { userId, page, pageSize })

  // 2. 构建查询条件
  const whereCondition = {}
  if (userId) {
    whereCondition.userId = userId
  }

  // 3. 获取最近消息并聚合
  try {
    const messages = await db.findRecentMessages(whereCondition)

    // 按 sessionId 聚合
    const sessionMap = new Map()
    for (const msg of messages) {
      if (!sessionMap.has(msg.sessionId)) {
        sessionMap.set(msg.sessionId, {
          sessionId: msg.sessionId,
          userId: msg.userId,
          firstMessageTime: msg.timestamp,
          lastMessageTime: msg.timestamp,
          messageCount: 0,
          lastMessage: (msg.content || '').substring(0, 100)
        })
      }
      const session = sessionMap.get(msg.sessionId)
      session.messageCount++

      const msgTime = new Date(msg.timestamp)
      if (msgTime < new Date(session.firstMessageTime)) {
        session.firstMessageTime = msg.timestamp
      }
      if (msgTime > new Date(session.lastMessageTime)) {
        session.lastMessageTime = msg.timestamp
        session.lastMessage = (msg.content || '').substring(0, 100)
      }
    }

    let sessions = [...sessionMap.values()]
    sessions.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime))

    const total = sessions.length
    const pagedSessions = sessions.slice((page - 1) * pageSize, page * pageSize)

    logger.info(MODULE, '会话查询成功', { total, returned: pagedSessions.length })

    return response.success({
      sessions: pagedSessions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    })
  } catch (err) {
    logger.error(MODULE, '会话查询失败', { error: err.message })
    return response.error('会话查询失败', 'DB_QUERY_ERROR', err.message)
  }
}

module.exports = { handle }