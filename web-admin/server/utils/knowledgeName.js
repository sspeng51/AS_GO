const axios = require('axios')
const crypto = require('crypto')
const { validKnowledgeId } = require('./ragTuningAuth')

// Metadata is optional: a name lookup must never fail an evaluation.
function createKnowledgeNameResolver(client = axios) {
  const cache = new Map()
  const pending = new Map()
  return async function knowledgeName(id) {
    const apiKey = process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY
    if (!validKnowledgeId(id) || !apiKey) return ''
    const key = `${crypto.createHash('sha256').update(apiKey).digest('hex')}:${id}`
    const cached = cache.get(key)
    if (cached?.expires > Date.now()) return cached.name
    if (pending.has(key)) return pending.get(key)
    const request = (async () => {
      let name = ''
      try {
        const response = await client.get(`https://open.bigmodel.cn/api/llm-application/open/knowledge/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${apiKey}` }, timeout: 5000
        })
        const body = response.data
        if (!body?.code || Number(body.code) === 200) {
          const info = body?.data || body
          if ((!info?.id || String(info.id) === id) && typeof info?.name === 'string') name = info.name.trim().slice(0, 200)
        }
      } catch { /* Keep the ID when metadata is unavailable or inaccessible. */ }
      if (cache.size >= 200) cache.delete(cache.keys().next().value)
      cache.set(key, { name, expires: Date.now() + (name ? 300000 : 30000) })
      return name
    })()
    pending.set(key, request)
    try { return await request } finally { pending.delete(key) }
  }
}

const resolveKnowledgeName = createKnowledgeNameResolver()
async function enrichKnowledgeName(run) {
  if (run.retrievalMode === 'graph') return run
  const id = run.knowledgeBase?.id || run.requestedKnowledgeId
  if (!run.knowledgeBase?.name && id) {
    const name = await resolveKnowledgeName(id)
    if (name) run.knowledgeBase = { ...run.knowledgeBase, id, name }
  }
  return run
}
module.exports = { createKnowledgeNameResolver, enrichKnowledgeName }
