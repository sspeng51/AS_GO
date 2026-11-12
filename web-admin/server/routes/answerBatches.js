const express = require('express')
const crypto = require('crypto')
const {within,coalescedReads}=require('../utils/batchProgress')
const { boundedInteger } = require('../utils/answerScheduling')
const embedding = require('../utils/embeddingEvaluation')
const isEmbedding = job => job.settings.evaluationMode === embedding.VERSION
const embeddingComplete = run => 'ABCDE'.split('').every(g => Number.isFinite(run.embeddingEvaluation?.scores?.[g]?.accuracy))
const COLLECTION = 'rag_answer_batches', CONTROLS = 'rag_answer_batch_controls'

function compactRun(run) {
  return { embeddingEvaluation: run.embeddingEvaluation, reference: run.reference, _id: run._id, query: run.query, knowledgeId: run.knowledgeId, generation: { model: run.generation?.model }, evidenceProtocol:run.evidenceProtocol, evaluationMode: run.evaluationMode, updatedAt: run.updatedAt, protocol: run.protocol, judgeProtocol: run.judgeProtocol, scoringVersion: run.scoringVersion, knowledgeBase: run.knowledgeBase,
    judgeModel: run.judgeModel, evaluationScope: run.evaluationScope, graphReady: !!run.graph, graphEmpty: run.graphEmpty, graphError: run.graphError, hasGraphDiagnostics: !!run.graphSnapshot,
    factualFollowup: run.factualFollowup ? Object.fromEntries(Object.entries(run.factualFollowup).filter(([key]) => key !== 'pools')) : undefined, lastError: run.lastError, active: run.active, progress: run.progress, stageErrors: run.stageErrors, generationStatus: run.generationStatus, phaseTimings: run.phaseTimings,
    variants: Object.fromEntries(Object.entries(run.variants || {}).map(([key, v]) => [key, {
      hasAnswer: !!v.answer, finishReason: v.finishReason, error: v.error, timings: v.timings, thinking: v.thinking, reasoningEffort: v.reasoningEffort,
      judge: v.judge ? { metrics: Object.fromEntries(Object.entries(v.judge.metrics || {}).map(([metric, value]) => [metric, { value: value.value }])), status: v.judge.status, verificationCoverage: v.judge.verificationCoverage, unknownClaims: v.judge.unknownClaims, warnings: (v.judge.warnings || []).slice(0, 3) } : null
    }])),
    calls: (run.calls || []).map(c => ({ stage: c.stage, usage: c.usage, latencyMs: c.latencyMs, groups: c.groups, attempt: c.attempt, answerChars: c.answerChars, reasoningChars: c.reasoningChars, firstTokenMs: c.firstTokenMs, error: c.error, timeoutMs: c.timeoutMs })) }
}

module.exports = function batchRoutes({ read, save, list, createRun, executePhase, requireAdmin, executionLimiter, endpoint }) {
  const router = express.Router(), owner = crypto.randomUUID(), queued = new Set(), writes = new Map()
  const live = new Map(), progressRead = coalescedReads(read)
  let tail = Promise.resolve()
  const persist = job => {
    if (job.status === 'running') live.set(job._id, job)
    const promise = (writes.get(job._id) || Promise.resolve()).catch(() => {}).then(async () => {
      job.updatedAt = new Date().toISOString()
      const { _id, ...data } = job
      await save(COLLECTION, _id, structuredClone(data))
    })
    writes.set(job._id, promise)
    return promise.finally(() => { if (writes.get(job._id) === promise) writes.delete(job._id) })
  }
  const paused = async id => {
    try { return (await read(CONTROLS, id)).pause === true } catch (e) { if (e.status === 404 || /NOT_EXIST|not found/i.test(e.message)) return false; throw e }
  }
  async function work(id) {
    const job = await read(COLLECTION, id)
    job.status = 'running'; job.owner = owner; job.leaseUntil = Date.now() + 60000
    job.activeIds = []; job.activeId = null
    const workStarted = Date.now()
    job.executionStartedAt = new Date(workStarted).toISOString()
    await persist(job)
    let heartbeatError
    const timer = setInterval(() => { job.leaseUntil = Date.now() + 60000; persist(job).catch(e => { heartbeatError = e }) }, 15000)
    timer.unref?.()
    try {
      const pending = [...job.pending]
      let cursor = 0
      const workers = Array.from({ length: Math.min(boundedInteger(process.env.ANSWER_QUESTION_CONCURRENCY, 2, 4), pending.length) }, async () => {
      while (cursor < pending.length && job.status === 'running') {
        if (heartbeatError) throw heartbeatError
        if (await paused(id)) { job.status = 'paused'; break }
        if (job.status !== 'running' || cursor >= pending.length) break
        const index = pending[cursor++], runId = job.ids[index]
        job.activeIds.push(runId); await persist(job)
        let run
        try {
          try { run = await read('rag_answer_experiments', runId) }
          catch (error) {
            if (error.status !== 404 && !/NOT_EXIST|not found/i.test(error.message)) throw error
            run = await createRun({ ...job.settings, query: job.queries[index], reference: job.references?.[index] ?? job.settings.reference, knowledgeId: job.knowledgeIds?.[index] ?? job.settings.knowledgeId, batchId: job._id }, job.createdBy, runId)
          }
          for (const phase of (isEmbedding(job) ? ['prepare', 'generate', 'embedding'] : ['prepare', 'generate', 'rubric', 'judge'])) {
            if (heartbeatError) throw heartbeatError
            if (job.status !== 'running' || await paused(id)) { job.status = 'paused'; break }
            run = await executePhase(runId, phase)
            job.summaries[index] = compactRun(run)
            await persist(job)
          }
          if (job.status === 'paused') { job.summaries[index] = compactRun(run); break }
          job.failures = job.failures.filter(i => i !== index)
          // A graph outage can finish A/B/D while C/E remain resumable.
          if (isEmbedding(job) ? !embeddingComplete(run) : ['A', 'B', 'C', 'D', 'E'].some(key => !run.variants[key]?.answer || !run.variants[key]?.judge || run.variants[key].judge.status === 'partial' || (run.evaluationMode && ['accuracy','precision','recall','f1'].some(m=>!Number.isFinite(run.variants[key].judge.metrics?.[m]?.value))))) job.failures.push(index)
          job.summaries[index] = compactRun(run)
        } catch (error) {
          try { run = await read('rag_answer_experiments', runId) } catch {}
          if (run) job.summaries[index] = compactRun(run)
          if (!job.failures.includes(index)) job.failures.push(index)
          if (!isEmbedding(job) && [401, 403, 409, 429, 504].includes(error.status)) { job.status = 'paused'; job.lastError = error.message; break }
        }
        job.activeIds = job.activeIds.filter(id => id !== runId)
        job.pending = job.pending.filter(i => i !== index)
        await persist(job)
      }
      })
      // Drain in-flight phases before releasing the lease, including on failure.
      const results = await Promise.allSettled(workers)
      const failed = results.find(result => result.status === 'rejected')
      if (failed) throw failed.reason
      if (!job.pending.length) job.status = job.failures.length ? 'completed_with_errors' : 'completed'
    } catch (error) { job.status = 'paused'; job.lastError = '批次已暂停，请检查后台连接后继续' }
    finally {
      clearInterval(timer); live.delete(job._id); job.leaseUntil = 0; job.activeId = null; job.activeIds = []
      job.executionMs = (job.executionMs || 0) + Date.now() - workStarted
      job.executionStartedAt = null
      await persist(job)
    }
  }
  function enqueue(id) {
    if (queued.has(id)) return
    queued.add(id)
    tail = tail.catch(() => {}).then(() => work(id)).catch(error => console.error('[AnswerBatch]', error.message)).finally(() => queued.delete(id))
  }
  router.post('/', requireAdmin, executionLimiter, endpoint(async (req, res) => {
    const vectorMode = req.body.evaluationMode === embedding.VERSION
    const cases = req.body.cases
    if (vectorMode && (!Array.isArray(cases) || !cases.length || cases.some(c => !c || typeof c.query !== 'string' || typeof c.reference !== 'string' || !c.reference.trim() || c.reference.length > 12000))) throw Object.assign(new Error('向量批次须提供问题和标准答案，每条标准不超过12000字'), {status:400})
    const queries = vectorMode ? cases.map(c => c.query) : req.body.queries
    if (!Array.isArray(queries) || !queries.length || (!vectorMode && queries.length > 100) || queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 1000)) throw Object.assign(new Error(vectorMode ? '请提供至少1题，每题不超过1000字' : '每批支持1–100题，每题不超过1000字'), { status: 400 })
    const unique = vectorMode ? queries.map(q => q.trim()) : [...new Set(queries.map(q => q.trim()))]
    const knowledgeIds = req.body.knowledgeIds ?? [req.body.knowledgeId || '']
    if (!Array.isArray(knowledgeIds) || !knowledgeIds.length || knowledgeIds.length > 10 || knowledgeIds.some(id => typeof id !== 'string')) throw Object.assign(new Error('请选择1–10个知识库'), { status: 400 })
    const libraries = [...new Set(knowledgeIds.map(id => id.trim()))]
    if (!vectorMode && unique.length * libraries.length > 100) throw Object.assign(new Error('每批问题数×知识库数最多100'), { status: 400 })
    for (const knowledgeId of libraries) await createRun({ ...req.body, knowledgeId, query: unique[0], ...(vectorMode ? {reference:cases[0].reference} : {}) }, req.user.username, undefined, false)
    const targets = libraries.flatMap(knowledgeId => unique.map((query,index) => ({ query, knowledgeId, reference: vectorMode ? cases[index].reference.trim() : req.body.reference || '' })))
    const sample = await createRun({ ...req.body, query: unique[0], ...(vectorMode ? {reference:cases[0].reference} : {}) }, req.user.username, undefined, false)
    const job = { _id: crypto.randomUUID(), createdBy: req.user.username, createdAt: new Date().toISOString(), status: 'queued',
      references: targets.map(t => t.reference), queries: targets.map(t => t.query), knowledgeIds: targets.map(t => t.knowledgeId), ids: targets.map(() => crypto.randomUUID()), pending: targets.map((_, i) => i), failures: [], summaries: {},
      settings: { evaluationMode: sample.evaluationMode, scoringVersion:sample.scoringVersion, evidenceProtocol:sample.evidenceProtocol, generation: sample.generation, judgeModel: sample.judgeModel, reference: sample.reference, knowledgeId: sample.knowledgeId, k: sample.k } }
    await persist(job); enqueue(job._id)
    res.status(202).json({ success: true, batch: job })
  }))
  router.get('/', endpoint(async (req, res) => res.json({ batches: (await list(COLLECTION, 100, {_id:1,status:1,queries:1,updatedAt:1,settings:1})).filter(job => (job.settings?.evaluationMode || '') === (req.query.evaluationMode || '')).map(job => ({ _id: job._id, status: job.status, total: job.queries.length, updatedAt: job.updatedAt })) })))
  router.get('/:id', endpoint(async (req, res) => {
    const stored = live.get(req.params.id) || await within(progressRead(COLLECTION, req.params.id), 15000, null)
    if (!stored) throw Object.assign(new Error('数据库读取进度超时，任务状态尚未确认；请稍后刷新，勿重复提交'), {status:503})
    const job = structuredClone(stored)
    // Optional active details share a short budget and coalesce across polls.
    const details = await within(Promise.all((job.activeIds || (job.activeId ? [job.activeId] : [])).map(async id => {
      try { return await progressRead('rag_answer_experiments', id) } catch { return null }
    })), 2000, null)
    job.progressDetailsDelayed = details === null
    for (const run of details || []) if (run) job.summaries[job.ids.indexOf(run._id)] = compactRun(run)
    if (job.status === 'running' && job.leaseUntil < Date.now() && !queued.has(job._id)) job.status = 'interrupted'
    if (job.status === 'queued' && !queued.has(job._id)) job.status = 'interrupted'
    res.json({ success: true, batch: job })
  }))
  router.post('/:id/refresh', requireAdmin, endpoint(async (req, res) => {
    const job = await read(COLLECTION, req.params.id)
    if (queued.has(job._id) || (job.status === 'running' && job.leaseUntil > Date.now())) throw Object.assign(new Error('批次执行中，结果会自动更新'), { status: 409 })
    for (let index = 0; index < job.ids.length; index++) {
      try { job.summaries[index] = compactRun(await read('rag_answer_experiments', job.ids[index])) } catch (e) { if (e.status !== 404) throw e }
    }
    await persist(job); res.json({ success: true })
  }))
  router.post('/:id/pause', requireAdmin, endpoint(async (req, res) => {
    await read(COLLECTION, req.params.id)
    await save(CONTROLS, req.params.id, { pause: true })
    res.json({ success: true })
  }))
  router.post('/:id/resume', requireAdmin, executionLimiter, endpoint(async (req, res) => {
    const job = await read(COLLECTION, req.params.id)
    if (queued.has(job._id) || (job.status === 'running' && job.leaseUntil > Date.now())) throw Object.assign(new Error('批次仍在执行，请等当前阶段结束'), { status: 409 })
    const outdated = isEmbedding(job) ? job.ids.map((_,i)=>i).filter(i=>!embeddingComplete(job.summaries[i] || {})) : job.ids.map((_, index) => index).filter(index => job.summaries[index] && (job.summaries[index].scoringVersion !== (job.settings.evaluationMode ? require('../utils/factualEvaluation').SCORING_VERSION : 'analytic-100-v2') || Object.values(job.summaries[index].variants || {}).some(v => v.judge?.status === 'partial' || (job.settings.evaluationMode && job.summaries[index].factualFollowup?.revision !== 2 && ['accuracy','precision','recall','f1'].some(m=>!Number.isFinite(v.judge?.metrics?.[m]?.value))))))
    if (isEmbedding(job)) {
      // Old paused batches may still contain the failed item in pending.
      // Finish untouched/interrupted work first; only a later resume retries failures.
      const remaining = job.pending.filter(index => !job.failures.includes(index))
      job.pending = remaining.length ? [...new Set(remaining)] : [...new Set([...job.pending, ...job.failures, ...outdated])]
    } else job.pending = [...new Set([...job.pending, ...job.failures, ...outdated])]
    if (!job.pending.length) return res.json({ success: true, batch: job })
    await save(CONTROLS, job._id, { pause: false })
    job.status = 'queued'; job.lastError = null
    await persist(job); enqueue(job._id)
    res.json({ success: true, batch: job })
  }))
  return router
}
module.exports.compactRun = compactRun
