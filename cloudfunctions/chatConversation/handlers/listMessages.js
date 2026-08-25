/**
 * 查询消息列表处理器
 * 支持按 userId + sessionId + 时间范围查询，带分页
 */

const db = require('../data/db')
const logger = require('../utils/logger')
const response = require('../utils/response')
const validator = require('../utils/validator')

async function handle(params) {
  const MODULE = 'ListMessages'

  // 1. 参数验证
  const errors = validator.validateListMessages(params)
  if (errors.length > 0) {
    logger.warn(MODULE, '参数验证失败', errors)
    return response.validationError(errors)
  }

  const userId = params.userId.trim()
  const sessionId = params.sessionId ? params.sessionId.trim() : null
  const page = parseInt(params.page) || 1
  const pageSize = Math.min(parseInt(params.pageSize) || 50, validator.MAX_PAGE_SIZE)
  const dateFrom = params.dateFrom || null
  const dateTo = params.dateTo || null

  logger.info(MODULE, '开始查询消息', { userId, sessionId, page, pageSize, dateFrom, dateTo })

  // 2. 构建查询条件
  const whereCondition = { userId }
  if (sessionId) {
    whereCondition.sessionId = sessionId
  }

  // 时间范围过滤
  if (dateFrom || dateTo) {
    const _ = db.getCommand()
    const timestampConditions = []

    if (dateFrom) {
      timestampConditions.push({ timestamp: _.gte(new Date(dateFrom)) })
    }
    if (dateTo) {
      const toDate = new Date(dateTo)
      toDate.setHours(23, 59, 59, 999)
      timestampConditions.push({ timestamp: _.lte(toDate) })
    }

    if (timestampConditions.length === 1) {
      whereCondition.timestamp = timestampConditions[0].timestamp
    } else if (timestampConditions.length > 1) {
      whereCondition.timestamp = _.and(timestampConditions[0].timestamp, timestampConditions[1].timestamp)
    }
  }

  // 3. 查询
  try {
    const skip = (page - 1) * pageSize
    const { messages, total } = await db.findMessages(whereCondition, { skip, limit: pageSize })

    // 4. 格式化输出
    const formattedMessages = (messages || []).map(msg => ({
      id: msg._id,
      userId: msg.userId,
      sessionId: msg.sessionId,
      direction: msg.direction,
      content: msg.content,
      messageType: msg.messageType || 'text',
      timestamp: msg.timestamp,
      metadata: msg.metadata || {},
      createdAt: msg.createdAt
    }))

    logger.info(MODULE, '消息查询成功', { total, returned: formattedMessages.length })

    return response.success({
      messages: formattedMessages,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    })
  } catch (err) {
    logger.error(MODULE, '消息查询失败', { error: err.message })
    return response.error('消息查询失败', 'DB_QUERY_ERROR', err.message)
  }
}

module.exports = { handle }