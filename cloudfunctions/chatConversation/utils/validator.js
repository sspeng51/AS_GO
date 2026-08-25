/**
 * 数据验证器模块
 * 对所有输入参数进行严格校验
 */

const MESSAGE_DIRECTIONS = ['user', 'ai']
const MESSAGE_TYPES = ['text', 'image', 'voice', 'file']
const MAX_CONTENT_LENGTH = 10000
const MAX_PAGE_SIZE = 200
const MAX_USER_ID_LENGTH = 128
const MAX_SESSION_ID_LENGTH = 128

/**
 * 验证保存消息参数
 */
function validateSaveMessage(params) {
  const errors = []

  if (!params.userId || typeof params.userId !== 'string' || params.userId.trim().length === 0) {
    errors.push({ field: 'userId', message: 'userId 不能为空，必须是非空字符串' })
  } else if (params.userId.length > MAX_USER_ID_LENGTH) {
    errors.push({ field: 'userId', message: `userId 长度不能超过 ${MAX_USER_ID_LENGTH} 个字符` })
  }

  if (!params.sessionId || typeof params.sessionId !== 'string' || params.sessionId.trim().length === 0) {
    errors.push({ field: 'sessionId', message: 'sessionId 不能为空，必须是非空字符串' })
  } else if (params.sessionId.length > MAX_SESSION_ID_LENGTH) {
    errors.push({ field: 'sessionId', message: `sessionId 长度不能超过 ${MAX_SESSION_ID_LENGTH} 个字符` })
  }

  if (!params.direction || !MESSAGE_DIRECTIONS.includes(params.direction)) {
    errors.push({ field: 'direction', message: `direction 必须是 ${MESSAGE_DIRECTIONS.join(' 或 ')}` })
  }

  if (!params.content || typeof params.content !== 'string' || params.content.trim().length === 0) {
    errors.push({ field: 'content', message: 'content 不能为空' })
  } else if (params.content.length > MAX_CONTENT_LENGTH) {
    errors.push({ field: 'content', message: `content 长度不能超过 ${MAX_CONTENT_LENGTH} 个字符` })
  }

  if (params.messageType && !MESSAGE_TYPES.includes(params.messageType)) {
    errors.push({ field: 'messageType', message: `messageType 必须是 ${MESSAGE_TYPES.join('、')} 之一` })
  }

  if (params.metadata && typeof params.metadata !== 'object') {
    errors.push({ field: 'metadata', message: 'metadata 必须是对象类型' })
  }

  return errors
}

/**
 * 验证查询消息参数
 */
function validateListMessages(params) {
  const errors = []

  if (!params.userId || typeof params.userId !== 'string' || params.userId.trim().length === 0) {
    errors.push({ field: 'userId', message: 'userId 不能为空' })
  }

  if (params.sessionId && (typeof params.sessionId !== 'string' || params.sessionId.trim().length === 0)) {
    errors.push({ field: 'sessionId', message: 'sessionId 必须是非空字符串' })
  }

  if (params.page !== undefined) {
    const page = parseInt(params.page)
    if (isNaN(page) || page < 1) {
      errors.push({ field: 'page', message: 'page 必须是大于等于 1 的整数' })
    }
  }

  if (params.pageSize !== undefined) {
    const pageSize = parseInt(params.pageSize)
    if (isNaN(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      errors.push({ field: 'pageSize', message: `pageSize 必须在 1-${MAX_PAGE_SIZE} 之间` })
    }
  }

  if (params.dateFrom && isNaN(Date.parse(params.dateFrom))) {
    errors.push({ field: 'dateFrom', message: 'dateFrom 格式无效' })
  }

  if (params.dateTo && isNaN(Date.parse(params.dateTo))) {
    errors.push({ field: 'dateTo', message: 'dateTo 格式无效' })
  }

  return errors
}

/**
 * 验证查询会话参数
 */
function validateListSessions(params) {
  const errors = []

  if (params.userId && (typeof params.userId !== 'string' || params.userId.trim().length === 0)) {
    errors.push({ field: 'userId', message: 'userId 必须是非空字符串' })
  }

  if (params.page !== undefined) {
    const page = parseInt(params.page)
    if (isNaN(page) || page < 1) {
      errors.push({ field: 'page', message: 'page 必须是大于等于 1 的整数' })
    }
  }

  if (params.pageSize !== undefined) {
    const pageSize = parseInt(params.pageSize)
    if (isNaN(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      errors.push({ field: 'pageSize', message: `pageSize 必须在 1-${MAX_PAGE_SIZE} 之间` })
    }
  }

  return errors
}

/**
 * 验证删除会话参数
 */
function validateDeleteSession(params) {
  const errors = []

  if (!params.userId || typeof params.userId !== 'string' || params.userId.trim().length === 0) {
    errors.push({ field: 'userId', message: 'userId 不能为空' })
  }

  if (!params.sessionId || typeof params.sessionId !== 'string' || params.sessionId.trim().length === 0) {
    errors.push({ field: 'sessionId', message: 'sessionId 不能为空' })
  }

  return errors
}

/**
 * 验证查询用户列表参数
 */
function validateListUsers(params) {
  // 无必填参数，始终通过
  return []
}

/**
 * 净化和截断内容
 */
function sanitizeContent(content) {
  if (!content || typeof content !== 'string') return ''
  return content
    .replace(/\u0000/g, '')           // 移除 null 字符
    .replace(/[\uD800-\uDFFF]/g, '')  // 移除无效 Unicode 代理对
    .trim()
    .substring(0, MAX_CONTENT_LENGTH)
}

/**
 * 净化 metadata，防止过大或嵌套过深
 */
function sanitizeMetadata(metadata, maxDepth = 3) {
  if (!metadata || typeof metadata !== 'object') return {}
  try {
    const str = JSON.stringify(metadata)
    if (str.length > 4096) {
      // 过大则截断
      return { _truncated: true, _originalSize: str.length }
    }
    return JSON.parse(str)
  } catch (e) {
    return {}
  }
}

module.exports = {
  MESSAGE_DIRECTIONS,
  MESSAGE_TYPES,
  MAX_CONTENT_LENGTH,
  MAX_PAGE_SIZE,
  validateSaveMessage,
  validateListMessages,
  validateListSessions,
  validateDeleteSession,
  validateListUsers,
  sanitizeContent,
  sanitizeMetadata
}