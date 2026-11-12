// Local diagnostic client; credentials stay in memory and are never printed.
const path = require('path')
const serverRoot = path.resolve(__dirname, '../web-admin/server')
require(require.resolve('dotenv', { paths: [serverRoot] })).config({ path: path.join(serverRoot, '.env') })
const { generateToken } = require(path.join(serverRoot, 'middleware/auth'))
const token = generateToken({ username: 'local-rag-diagnostic', role: 'admin' }, '10m')
const port = process.argv.find(arg => arg.startsWith('--port='))?.slice(7) || '3108'
if (!/^\d{2,5}$/.test(port)) throw new Error('无效本地端口')
async function request(route, body) {
  const response = await fetch(`http://localhost:${port}/api/rag-tuning${route}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(240000)
  })
  const data = await response.json()
  console.log(JSON.stringify({ route, status: response.status, error: data.error, stage: data.stage, errorId: data.errorId }))
  if (!response.ok) throw new Error('诊断请求失败，见上方错误编号')
  return data
}
async function main() {
  if (process.argv.includes('--direct-cloud')) {
    const cloudbase = require(require.resolve('@cloudbase/node-sdk', { paths: [serverRoot] }))
    const app = cloudbase.init({ env: process.env.CLOUDBASE_ENV_ID, secretId: process.env.CLOUDBASE_SECRET_ID, secretKey: process.env.CLOUDBASE_SECRET_KEY })
    const { signTuningRequest } = require(path.join(serverRoot, 'utils/ragTuningAuth'))
    const payload = { query: '含磷酸盐的废水会怎样影响砷的吸附去除，原因是什么？', topK: 10, knowledgeId: process.env.ZHIPU_KNOWLEDGE_ID, retrievalMode: 'knowledge' }
    const data = signTuningRequest(payload, process.env.RAG_TUNING_SHARED_SECRET || process.env.STREAM_SHARED_SECRET)
    const result = await app.callFunction({ name: 'processKnowledge', data: { action: 'rag.tuning.search', data } }, { timeout: 90000, retryOptions: { retries: 0 } })
    const body = typeof result.result === 'string' ? JSON.parse(result.result) : result.result
    console.log(JSON.stringify({ requestId: result.requestId, success: body.success, error: body.error, resultCount: body.evidences?.length }))
    return
  }
  if (process.argv.includes('--diagnostics')) {
    const { rows } = await request('/review-queue')
    console.log(JSON.stringify(rows.filter(row => ['failed', 'blocked', 'running'].includes(row.status)).slice(0, 8).map(row => ({ id: row._id, status: row.status, error: row.attemptError, createdAt: row.createdAt }))))
    return
  }
  await request('/settings')
  if (process.argv.includes('--knowledge-check')) {
    for (const knowledgeId of [process.env.ZHIPU_KNOWLEDGE_ID]) {
      const { run } = await request('/retrieve', { query: '含磷酸盐的废水会怎样影响砷的吸附去除，原因是什么？', knowledgeId, k: 10, retrievalMode: 'knowledge', batchId: 'local-kb-diagnostic' })
      console.log(JSON.stringify({ knowledgeId, id: run._id, eligible: run.metrics?.eligible, error: run.error, errorDetail: run.errorDetail, returned: run.results.length }))
      if (!run.metrics?.eligible) { process.exitCode = 1; continue }
      if (process.argv.includes('--assess') && run.results.length) {
        const assessed = await request(`/runs/${run._id}/judge`, { autoEvidencePoints: true, skipExisting: true })
        const latest = assessed.run || (await request(`/runs/${run._id}`)).run
        const { quickMetrics } = await import('../web-admin/client/src/views/tuning/quickMetrics.mjs')
        console.log(JSON.stringify({ knowledgeId, metrics: quickMetrics(latest) }))
      }
    }
    return
  }
  const queries = process.argv.includes('--batch') ? ['砷资源化利用主要有哪些途径？', '吸附法与化学沉淀法处理低浓度含砷废水各有什么优缺点？', '是否存在一种适用于所有含砷废水、能够完全去除砷且不产生任何废物的处理技术？'] : ['砷资源化利用主要有哪些途径？']
  for (const query of queries) {
  const existing = process.argv.find(arg => arg.startsWith('--run='))?.slice(6)
  const { run } = existing ? await request(`/runs/${existing}`) : await request('/retrieve', { query, k: 5, retrievalMode: 'knowledge', batchId: 'local-diagnostic' })
  console.log(JSON.stringify({ query: run.query }))
  console.log(JSON.stringify({ runId: run._id, returned: run.results.length, eligible: run.metrics?.eligible, error: run.error }))
  if (run.metrics?.eligible && run.results.length) {
    const assessed = await request(`/runs/${run._id}/judge`, { autoEvidencePoints: true })
    if (!assessed.run?.judge) throw new Error('初评接口未返回完整记录')
    const result = await request(`/runs/${run._id}`)
    const { quickMetrics } = await import('../web-admin/client/src/views/tuning/quickMetrics.mjs')
    console.log(JSON.stringify({ metrics: quickMetrics(result.run) }))
    const reused = await request(`/runs/${run._id}/judge`, { autoEvidencePoints: true, skipExisting: true })
    if (!reused.skipped || reused.judge.id !== assessed.judge.id) throw new Error('已完成记录未正确复用')
    console.log(JSON.stringify({ savedAndReloaded: true, duplicateCallSkipped: true, modelCalls: result.run.judge.modelCalls, tokens: result.run.judge.usage?.total_tokens }))
  }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
