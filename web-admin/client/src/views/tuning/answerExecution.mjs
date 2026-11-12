// Reserve starts globally so two question workers share the API's request budget.
export function createRequestGate(interval = 2200, clock = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let next = 0
  return async () => {
    const now = clock(), slot = Math.max(now, next)
    next = slot + interval
    if (slot > now) await sleep(slot - now)
  }
}
export async function runQuestionQueue(items, worker, shouldStop = () => false, concurrency = 2) {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!shouldStop()) {
      const index = cursor++
      if (index >= items.length) break
      await worker(items[index], index)
    }
  }))
}
