const MAX_OVERLAP = 400

function appendWithoutOverlap(existing, addition, maxOverlap = MAX_OVERLAP) {
  const base = String(existing || '')
  const next = String(addition || '')
  const limit = Math.min(maxOverlap, base.length, next.length)
  for (let size = limit; size > 0; size--) {
    if (base.slice(-size) === next.slice(0, size)) return base + next.slice(size)
  }
  return base + next
}

function continuationMessages(messages, partial) {
  return [
    ...messages,
    { role: 'assistant', content: String(partial || '') },
    { role: 'user', content: '上一次回答在中途停止。请从已有回答的最后一句继续，不要重复已输出的内容，也不要解释续答过程。' }
  ]
}

module.exports = { MAX_OVERLAP, appendWithoutOverlap, continuationMessages }
