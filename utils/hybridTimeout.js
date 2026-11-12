const DEFAULT_HYBRID_TIMEOUT = 85000
const NETWORK_BUFFER = 5000
const NEO4J_RETRY_TIMEOUT = 15000
const CLIENT_HARD_TIMEOUT = 70000

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/**
 * 混合检索是顺序链路：知识库 → schema → 规划（最多两次）→ 图谱查询。
 * 客户端等待时间不能短于这些阶段的最大预算之和，否则会丢弃已在返回途中的结果。
 */
function calculateHybridTimeout(config = {}) {
  const zhipu = config.zhipu || {}
  const retrieval = config.retrieval || {}
  const graph = config.graph || {}
  const knowledgeTimeout = positiveNumber(zhipu.cloudTimeout, 15000)
  const knowledgeAttempts = Number(retrieval.rerankStatus) === 1 ? 2 : 1
  const plannerTimeout = positiveNumber(graph.plannerTimeout, 12000)
  const queryTimeout = positiveNumber(graph.queryTimeout, 15000)
  const queryStageBudget = queryTimeout < NEO4J_RETRY_TIMEOUT
    ? queryTimeout + NEO4J_RETRY_TIMEOUT
    : queryTimeout
  const configured = positiveNumber(graph.hybridTimeout, DEFAULT_HYBRID_TIMEOUT)
  const stageBudget = knowledgeTimeout * knowledgeAttempts +
    plannerTimeout * 2 +
    queryStageBudget * 2 +
    NETWORK_BUFFER

  // CloudBase 会在约 120 秒强制终止。客户端应更早结束等待，让主回答
  // 使用已经拿到的证据或直接降级，避免最终暴露 501002 server timeout。
  return Math.min(Math.max(configured, stageBudget), CLIENT_HARD_TIMEOUT)
}

module.exports = {
  DEFAULT_HYBRID_TIMEOUT,
  CLIENT_HARD_TIMEOUT,
  calculateHybridTimeout
}
