/**
 * 删除会话处理器
 * 删除指定用户下指定会话的全部消息
 */

const db = require('../data/db')
const logger = require('../utils/logger')
const response = require('../utils/response')
const validator = require('../utils/validator')

async function handle(params) {
  const MODULE = 'DeleteSession'

  // 1. 参数验证
  const errors = validator.validateDeleteSession(params)
  if (errors.length > 0) {
    logger.warn(MODULE, '参数验证失败', errors)
    return response.validationError(errors)
  }

  const userId = params.userId.trim()
  const sessionId = params.sessionId.trim()

  logger.info(MODULE, '开始删除会话', { userId, sessionId })

  // 2. 执行删除
  try {
    const { deletedCount } = await db.deleteSessionMessages(userId, sessionId)

    logger.info(MODULE, '会话删除完成', { userId, sessionId, deletedCount })

    return response.success({
      deletedCount,
      userId,
      sessionId
    }, deletedCount > 0 ? `成功删除 ${deletedCount} 条消息` : '会话无消息记录')
  } catch (err) {
    logger.error(MODULE, '会话删除失败', { error: err.message, userId, sessionId })
    return response.error('会话删除失败', 'DB_DELETE_ERROR', err.message)
  }
}

module.exports = { handle }