/**
 * 查询活跃用户列表处理器
 * 获取有对话记录的所有用户，按最后活跃时间排序
 */

const db = require('../data/db')
const logger = require('../utils/logger')
const response = require('../utils/response')

async function handle(params) {
  const MODULE = 'ListUsers'

  logger.info(MODULE, '开始查询活跃用户')

  try {
    const users = await db.findActiveUsers()

    logger.info(MODULE, '活跃用户查询成功', { count: users.length })

    return response.success({
      users,
      total: users.length
    })
  } catch (err) {
    logger.error(MODULE, '活跃用户查询失败', { error: err.message })
    return response.error('用户查询失败', 'DB_QUERY_ERROR', err.message)
  }
}

module.exports = { handle }