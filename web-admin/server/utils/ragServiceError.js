function modelError(error, context = {}) {
  const upstreamStatus = error.response?.status
  const rawCode = error.response?.data?.error?.code || error.code || ''
  const upstreamCode = /^[\w.-]{1,60}$/.test(String(rawCode)) ? String(rawCode) : ''
  let message = '智谱模型请求失败，请查看后台日志中的错误编号'
  let status = 502
  if (['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error.code)) {
    const stage = context.stageLabel || '模型请求'
    const seconds = Number.isFinite(context.timeoutMs) ? `（等待上限 ${Math.round(context.timeoutMs / 1000)} 秒）` : ''
    message = `智谱${stage}响应超时${seconds}；已保存的结果保留，请稍后重试未完成阶段`
    status = 504
  } else if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EACCES'].includes(error.code)) {
    message = '后台无法连接智谱模型服务，请检查后台服务器的网络、代理或域名解析'
    status = 503
  } else if (upstreamStatus === 401 || upstreamStatus === 403) {
    message = '智谱模型鉴权失败，请检查后台 ZHIPU_API_KEY / BIGMODEL_API_KEY 及模型调用权限'
  } else if (upstreamStatus === 429) {
    message = '智谱模型调用受限，请检查账户额度和并发限制，稍后重试'
    status = 429
  } else if (upstreamStatus === 400 || upstreamStatus === 404 || upstreamStatus === 422) {
    const thinkingRejected = upstreamCode === '1210' && /不支持关闭思考|始终思考|does not support.*(?:disabl|non.thinking)|always.think/i.test(String(error.response?.data?.error?.message || ''))
    message = thinkingRejected ? '当前模型不支持关闭思考，请使用最低思考强度 low，并更新后台模型参数配置' : upstreamCode === '1210' ? '智谱请求参数校验失败，请检查思考模式、输出Token上限等参数；GLM-5.3须使用 low 思考模式' : '智谱拒绝了模型请求，请检查后台模型名称、模型权限及请求参数'
  } else if (upstreamStatus >= 500) {
    message = '智谱模型服务暂时不可用，请稍后重试'
    status = 503
  }
  return Object.assign(new Error(message + (upstreamCode ? `（错误码 ${upstreamCode}）` : '')), { status, stage: 'model_request', upstreamStatus, upstreamCode })
}
module.exports = { modelError }
