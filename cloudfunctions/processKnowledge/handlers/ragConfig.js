/**
 * RAG 配置下发 handler
 *
 * action: rag.config.get
 * 将云函数侧的 RAG 调优配置下发给小程序前端
 */

const { getRagConfig } = require('../lib/ragConfig')

async function handleRagConfigGet(data, context) {
  const config = await getRagConfig()
  return { success: true, config }
}

module.exports = handleRagConfigGet
