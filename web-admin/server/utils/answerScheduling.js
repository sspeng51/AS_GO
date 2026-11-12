// A process-wide cap also covers manual requests and concurrent batches.
function boundedInteger(value, fallback, max) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback
}
function createLimiter(limit) {
  let active = 0
  const queue = []
  function drain() {
    while (active < limit && queue.length) {
      const { task, resolve, reject } = queue.shift()
      active++
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; drain() })
    }
  }
  return task => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); drain() })
}
const modelSlot = createLimiter(boundedInteger(process.env.ANSWER_MODEL_CONCURRENCY, 4, 8))
function transientConnection(error) {
  return ['ECONNRESET', 'EAI_AGAIN', 'ECONNREFUSED', 'ENOTFOUND'].includes(error.upstreamCode || error.code)
}
module.exports = { boundedInteger, createLimiter, modelSlot, transientConnection }
