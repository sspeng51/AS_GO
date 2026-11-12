const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createLimiter, boundedInteger, transientConnection } = require('../web-admin/server/utils/answerScheduling')
const { createHarness } = require('./fixtures/rag-tuning-harness')

test('全局槽位限制峰值并发，失败释放槽位，不遗漏排队任务', async () => {
  const limit = createLimiter(4)
  let active = 0, peak = 0, finished = 0
  const results = await Promise.allSettled(Array.from({ length: 17 }, (_, i) => limit(async () => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--; finished++
    if (i === 2) throw new Error('failure')
    return i
  })))
  assert.equal(peak, 4); assert.equal(active, 0); assert.equal(finished, 17)
  assert.equal(results.filter(r => r.status === 'rejected').length, 1)
  assert.equal(boundedInteger('99', 2, 4), 2)
  assert.equal(boundedInteger('3', 2, 4), 3)
  assert.equal(transientConnection({ upstreamCode: 'ECONNRESET' }), true)
  assert.equal(transientConnection({ code: 'ETIMEDOUT' }), false)
})

test('两题后台并行受全局上限约束；无效JSON补评一次后停止且不重生回答', async t => {
  const { http, token, state } = createHarness()
  state.modelDelayMs = 30
  state.invalidBatchJSON = true
  const server = http.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests/batches`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token('admin')}` }
  let job = (await (await fetch(base, { method: 'POST', headers, body: JSON.stringify({ queries: ['并行题一', '并行题二'] }) })).json()).batch
  const end = Date.now() + 10000
  let peakQuestions = 0
  while (!['completed', 'completed_with_errors', 'paused'].includes(job.status) && Date.now() < end) {
    await new Promise(resolve => setTimeout(resolve, 5))
    job = (await (await fetch(`${base}/${job._id}`, { headers })).json()).batch
    peakQuestions = Math.max(peakQuestions, job.activeIds?.length || 0)
  }
  assert.equal(job.status, 'completed_with_errors')
  assert.equal(peakQuestions, 2)
  assert.equal(state.peakModels, 4)
  assert.equal(state.modelCalls.length, 16) // 2 × (5 answers + rubric + 2 judges)
  assert.equal(job.pending.length, 0)
  assert.equal(job.failures.length, 2)
  assert.ok(job.executionMs > 0)
  assert.ok(Object.values(job.summaries).every(r => r.phaseTimings.judge >= 0 && Object.values(r.variants).every(v => v.hasAnswer)))
})

test('生成连接中断与标准JSON故障各补试一次，最后评分完整且日志保留失败', async t => {
  const { http, token, state, tables } = createHarness()
  state.generationResetOnce = true; state.rubricInvalidOnce = true
  const server = http.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests/batches`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token('admin')}` }
  let job = (await (await fetch(base, { method: 'POST', headers, body: JSON.stringify({ queries: ['连接恢复测试'] }) })).json()).batch
  const end = Date.now() + 10000
  while (!['completed', 'completed_with_errors', 'paused'].includes(job.status) && Date.now() < end) {
    await new Promise(resolve => setTimeout(resolve, 10))
    job = (await (await fetch(`${base}/${job._id}`, { headers })).json()).batch
  }
  assert.equal(job.status, 'completed')
  assert.equal(state.modelCalls.length, 9)
  const run = tables.get('rag_answer_experiments').get(job.ids[0])
  assert.equal(run.calls.filter(c => c.errorCode === 'ECONNRESET').length, 1)
  assert.equal(run.calls.filter(c => c.validationError).length, 1)
  assert.ok(Object.values(run.variants).every(v => v.judge.status !== 'partial'))
  assert.ok(run.calls.every(c => c.queueMs >= 0))
})
