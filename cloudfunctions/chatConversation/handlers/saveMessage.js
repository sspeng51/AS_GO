/**
 * 保存消息处理器
 * 将小程序端产生的用户/AI对话消息持久化存储
 */

const db = require('../data/db')
const logger = require('../utils/logger')
const response = require('../utils/response')
const validator = require('../utils/validator')

async function handle(params) {
  const MODULE = 'SaveMessage'

  // 1. 参数验证
  const errors = validator.validateSaveMessage(params)
  if (errors.length > 0) {
    logger.warn(MODULE, '参数验证失败', errors)
    return response.validationError(errors)
  }

  // 2. 数据净化
  const userId = params.userId.trim()
  const sessionId = params.sessionId.trim()
  const direction = params.direction
  const content = validator.sanitizeContent(params.content)
  const messageType = params.messageType || 'text'
  const metadata = validator.sanitizeMetadata(params.metadata)

  if (content.length === 0) {
    return response.error('净化后消息内容为空', 'EMPTY_CONTENT')
  }

  logger.info(MODULE, '开始保存消息', { userId, sessionId, direction, messageType, contentLen: content.length })

  // 3. 构建记录
  const now = new Date()
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

  const messageRecord = {
    _id: messageId,
    userId,
    sessionId,
    direction,
    content,
    messageType,
    timestamp: now,
    metadata: {
      nickName: (metadata && metadata.nickName) || '',
      avatarUrl: (metadata && metadata.avatarUrl) || '',
      ...metadata,
      storedAt: now.toISOString()
    },
    createdAt: now
  }

  // 4. 写入数据库
  try {
    const result = await db.insertMessage(messageRecord)
    logger.info(MODULE, '消息保存成功', { messageId, userId, sessionId })

    return response.success({
      messageId,
      timestamp: now.toISOString()
    }, '消息保存成功')
  } catch (err) {
    logger.error(MODULE, '消息保存失败', { error: err.message })
    return response.error('消息保存失败', 'DB_WRITE_ERROR', err.message)
  }
}

module.exports = { handle }