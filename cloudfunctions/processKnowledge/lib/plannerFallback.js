'use strict'

// 规划模型只是图谱检索的可降级增强。网络抖动、连接重置和上游超时都应尝试下一模型；
// 鉴权/权限错误则没有重试价值，直接保留明确错误。
function isRetryablePlannerRequestError(error) {
  const statusCode = Number(error && (error.statusCode || error.status))
  if ([401, 403].includes(statusCode)) return false
  const code = String(error && error.code || '')
  const message = String(error && error.message || '')
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(code) ||
    /请求超时|超时|timed?\s*out|network|连接重置|网络/i.test(message)
}

// GLM-5.3 系列为始终思考模型，拒绝 thinking: { type: 'disabled' }。
// 规划场景使用 low，以尽量缩短实体关系解析的等待时间；其它回退模型保持关闭思考。
function plannerThinkingConfig(model) {
  return String(model || '').startsWith('glm-5.3')
    ? { reasoning_effort: 'low' }
    : { type: 'disabled' }
}

module.exports = { isRetryablePlannerRequestError, plannerThinkingConfig }
