/**
 * 响应工具模块
 * 统一 API 响应格式
 */

const logger = require('./logger')

/**
 * 构建成功响应
 */
function success(data = {}, message) {
  const response = {
    success: true,
    data
  }
  if (message) {
    response.message = message
  }
  return response
}

/**
 * 构建分页成功响应
 */
function paginated(items, pagination) {
  return {
    success: true,
    data: items,
    pagination: {
      page: pagination.page || 1,
      pageSize: pagination.pageSize || 20,
      total: pagination.total || 0,
      totalPages: pagination.totalPages || Math.ceil((pagination.total || 0) / (pagination.pageSize || 20))
    }
  }
}

/**
 * 构建错误响应
 */
function error(message, code = 'INTERNAL_ERROR', details) {
  logger.error('Response', message, { code, details })
  const response = {
    success: false,
    error: {
      message,
      code
    }
  }
  if (details) {
    response.error.details = details
  }
  return response
}

/**
 * 验证错误响应
 */
function validationError(errors) {
  return {
    success: false,
    error: {
      message: '参数验证失败',
      code: 'VALIDATION_ERROR',
      details: errors
    }
  }
}

module.exports = { success, paginated, error, validationError }