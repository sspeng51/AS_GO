/**
 * chatConversation 云函数入口
 *
 * 职责: 专门处理用户对话数据的存储、检索、更新和删除操作
 * 服务对象: 后台管理系统 (web-admin)
 *
 * 模块结构:
 *   data/db.js       - 数据库操作层
 *   handlers/         - 业务处理器
 *   utils/            - 工具模块 (日志、响应、验证)
 *
 * API 接口:
 *   conversation.saveMessage   - 保存对话消息
 *   conversation.listMessages  - 查询消息列表
 *   conversation.listSessions  - 查询会话列表
 *   conversation.deleteSession - 删除会话
 *   conversation.listUsers     - 查询活跃用户
 */

const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const logger = require('./utils/logger')
const response = require('./utils/response')
const db = require('./data/db')

// 业务处理器
const saveMessage = require('./handlers/saveMessage')
const listMessages = require('./handlers/listMessages')
const listSessions = require('./handlers/listSessions')
const deleteSession = require('./handlers/deleteSession')
const listUsers = require('./handlers/listUsers')

// 版本号
const VERSION = '1.0.0'

function hasValidAdminSecret(value) {
  const expected = process.env.CHAT_CONVERSATION_ADMIN_SECRET || ''
  if (expected.length < 32 || !value) return false
  const actualBuffer = Buffer.from(String(value))
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

// 动作路由表
const ACTION_ROUTES = {
  'conversation.saveMessage':   { handler: saveMessage,   description: '保存对话消息' },
  'conversation.listMessages':  { handler: listMessages,  description: '查询消息列表' },
  'conversation.listSessions':  { handler: listSessions,  description: '查询会话列表' },
  'conversation.deleteSession': { handler: deleteSession, description: '删除会话' },
  'conversation.listUsers':     { handler: listUsers,     description: '查询活跃用户' },
  'system.ping':                { handler: null,          description: '健康检查' }
}

// ==================== 初始化 ====================

let initialized = false

function initCloud() {
  if (initialized) return

  const envId = process.env.CLOUDBASE_ENV_ID || 'cloud1-6gbzplmt4a3dc5b5'
  cloud.init({ env: envId })

  const database = cloud.database()
  const command = database.command

  db.init(database, command)

  initialized = true
  logger.info('Main', `云函数初始化完成`, { version: VERSION, envId })
}

// ==================== 主入口 ====================

exports.main = async (event, context) => {
  const startTime = Date.now()
  const { action, data = {} } = event || {}

  // 请求日志
  logger.info('Main', `收到请求: ${action}`, {
    userId: data.userId,
    sessionId: data.sessionId,
    requestId: context?.requestId
  })

  // 1. 初始化
  try {
    initCloud()
  } catch (err) {
    logger.error('Main', '初始化失败', { error: err.message })
    return response.error('云函数初始化失败', 'INIT_ERROR', err.message)
  }

  // 2. 路由分发
  try {
    // 健康检查
    if (action === 'system.ping') {
      const elapsed = Date.now() - startTime
      return response.success({
        version: VERSION,
        service: 'chatConversation',
        timestamp: new Date().toISOString(),
        uptime: elapsed,
        env: process.env.CLOUDBASE_ENV_ID || 'cloud1-6gbzplmt4a3dc5b5',
        actions: Object.keys(ACTION_ROUTES).filter(k => k !== 'system.ping')
      })
    }

    // 该函数提供跨用户查询与删除能力，所有业务动作必须使用独立管理密钥。
    // 密钥只允许通过云函数环境变量配置，不接受默认值。
    if (!hasValidAdminSecret(event && event.adminSecret)) {
      logger.warn('Main', `拒绝未授权请求: ${action}`)
      return response.error('未授权访问', 'UNAUTHORIZED')
    }

    // 查找处理器
    const route = ACTION_ROUTES[action]
    if (!route || !route.handler) {
      logger.warn('Main', `未知操作: ${action}`)
      return response.error(`未知操作: ${action}`, 'UNKNOWN_ACTION', {
        availableActions: Object.keys(ACTION_ROUTES)
      })
    }

    // 执行业务处理
    const result = await route.handler.handle(data)

    const elapsed = Date.now() - startTime
    logger.info('Main', `请求完成: ${action}`, { elapsed: `${elapsed}ms`, success: result.success })

    return result
  } catch (err) {
    const elapsed = Date.now() - startTime
    logger.error('Main', '未捕获的异常', {
      action,
      error: err.message,
      stack: err.stack?.substring(0, 300),
      elapsed: `${elapsed}ms`
    })

    return response.error('服务器内部错误', 'INTERNAL_ERROR')
  }
}
