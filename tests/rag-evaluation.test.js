const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateJudge } = require('../web-admin/server/utils/judgeValidation')
const { modelError } = require('../web-admin/server/utils/ragServiceError')

test('知识库名称用于展示，同名库和历史无名称记录仍按 ID 正确分组', async () => {
  const { buildReport } = await import('../web-admin/client/src/views/tuning/quickMetrics.mjs')
  const run = { query: 'Q1', k: 5, metrics: { eligible: true }, results: [] }
  const a = { ...run, knowledgeBase: { id: 'A', name: '砷知识库' } }
  const b = { ...run, knowledgeBase: { id: 'B', name: '砷知识库' } }
  const report = buildReport([a, b, { ...run, query: 'Q2', knowledgeBase: { id: 'A' } }], { hitRate: 'Hit Rate' }, {})
  assert.equal(report.length, 2)
  assert.equal(report[0].count, 2)
  assert.match(report[0].label, /砷知识库（A）/)
  assert.match(report[1].label, /砷知识库（B）/)
  assert.match(buildReport([a], {}, {})[0].label, /^砷知识库 ·/)
  assert.match(buildReport([{ ...run, knowledgeBase: { id: 'C' } }], {}, {})[0].label, /^C ·/)
})

test('名称查询去重缓存、接口失败回退且不同账号隔离', async () => {
  const { createKnowledgeNameResolver } = require('../web-admin/server/utils/knowledgeName')
  const old = process.env.ZHIPU_API_KEY
  process.env.ZHIPU_API_KEY = 'fixture-name-key'
  let calls = 0
  const resolve = createKnowledgeNameResolver({ async get() { calls++; return { data: { code: 200, data: { name: '领域知识库' } } } } })
  try {
    assert.deepEqual(await Promise.all([resolve('A'), resolve('A')]), ['领域知识库', '领域知识库'])
    assert.equal(await resolve('A'), '领域知识库')
    assert.equal(calls, 1)
    process.env.ZHIPU_API_KEY = 'other-fixture-key'
    await resolve('A')
    assert.equal(calls, 2)
    assert.equal(await resolve('../invalid'), '')
    const failed = createKnowledgeNameResolver({ async get() { throw new Error('metadata unavailable') } })
    assert.equal(await failed('A'), '')
  } finally { if (old === undefined) delete process.env.ZHIPU_API_KEY; else process.env.ZHIPU_API_KEY = old }
})

test('六项指标逐题计算，候选池估算隔离正式标准，空结果计入命中率', async () => {
  const { quickMetrics, buildReport } = await import('../web-admin/client/src/views/tuning/quickMetrics.mjs')
  const run = { query: 'Q1', targetId: 'A', k: 2, metrics: { eligible: true }, results: [{ evaluationId: 'a' }, { evaluationId: 'b' }], judge: {
    model: 'fixture', grades: [{ id: 'a', grade: 0 }, { id: 'b', grade: 2 }],
    referencePool: { grades: [{ id: 'a', grade: 0 }, { id: 'b', grade: 2 }, { id: 'c', grade: 1 }] }
  } }
  const score = quickMetrics(run, 'model')
  assert.equal(score.precisionAtK.value, 0.5)
  assert.equal(score.recallAtK.value, 0.5)
  assert.equal(score.mrr.value, 0.5)
  assert.equal(score.hitRate.value, 1)
  assert.equal(score.contextRelevance.value, 0.5)
  assert.ok(Math.abs(score.ndcgAtK.value - (3 / Math.log2(3)) / (3 + 1 / Math.log2(3))) < 1e-10)
  assert.equal(score.recallAtK.basis, '模型候选池估算')
  assert.equal(quickMetrics(run, 'confirmed').recallAtK.value, null)
  const empty = { ...run, query: 'Q2', results: [], judge: null }
  assert.equal(quickMetrics(empty, 'model').hitRate.value, 0)
  assert.equal(quickMetrics(empty, 'model').contextRelevance.value, null)
  const failed = { ...empty, query: 'Q3', metrics: { eligible: false } }
  const report = buildReport([run, empty, failed], { hitRate: 'Hit Rate', recallAtK: 'Recall' }, {}, 'model', false)[0]
  assert.equal(report.metrics.hitRate.value, 0.5)
  assert.equal(report.metrics.hitRate.samples, 2)
  assert.equal(report.metrics.recallAtK.samples, 1)
  assert.equal(report.questions.length, 3)
})

test('简化报告分开评分来源、K与模型，共同样本要求相同问题和证据点', async () => {
  const { quickMetrics, runState, buildReport } = await import('../web-admin/client/src/views/tuning/quickMetrics.mjs')
  const makeRow = (query, kb, grade = 2) => ({ query, k: 5, targetId: kb, results: [{ evaluationId: 'a' }], metrics: { eligible: true, precisionAtK: 0, rerankMode: 'enabled' }, testCase: { evidencePoints: ['条件'] }, judge: { model: 'model-a', grades: [{ id: 'a', grade }], coverage: [{ point: 0 }] } })
  const a = makeRow('问题1', 'A'), b = makeRow('问题1', 'B')
  assert.equal(quickMetrics(a, 'model').precisionAtK.value, 0.2)
  assert.equal(quickMetrics(a, 'confirmed').precisionAtK.value, 0)
  assert.equal(runState({ ...a, autoError: '评估失败' }).key, 'judgeFailed')
  assert.equal(runState({ ...a, loadError: '读取失败' }).key, 'loadFailed')
  const names = { precisionAtK: 'Precision', evidenceCoverage: '覆盖率' }
  const report = buildReport([a, makeRow('问题2', 'A'), b], names, {}, 'model', true)
  assert.deepEqual(report.map(row => row.metrics.precisionAtK.samples), [1, 1])
  b.testCase.evidencePoints = ['另一标准']
  assert.deepEqual(buildReport([a, b], names, {}, 'model', true).map(row => row.metrics.evidenceCoverage.samples), [0, 0])
  assert.equal(buildReport([a, { ...a, k: 10 }], names, {}).length, 2)
  assert.equal(buildReport([a, { ...a, judge: { ...a.judge, model: 'model-b' } }], names, {}).length, 2)
  assert.equal(buildReport([a, { ...a }], names, {})[0].count, 1)
  assert.match(quickMetrics({ ...a, metrics: { eligible: true }, autoError: 'failed', judge: null }).precisionAtK.basis, /失败/)
})

test('模型失败区分超时、鉴权、限流与网络，不暴露上游密钥或正文', () => {
  assert.equal(modelError({ code: 'ECONNABORTED' }).status, 504)
  assert.match(modelError({ response: { status: 401 } }).message, /鉴权失败/)
  assert.equal(modelError({ response: { status: 429 } }).status, 429)
  assert.match(modelError({ code: 'ENOTFOUND' }).message, /网络/)
  const result = modelError({ message: 'secret-key', response: { status: 400, data: { error: { message: 'secret-key', code: '1211' } } } })
  assert.match(result.message, /1211/)
  assert.ok(!result.message.includes('secret-key'))
})

test('模型评估兼容短编号、字符串等级与引文编号，拒绝伪造依据', () => {
  const input = { evidencePoints: ['处理方法'], results: [{ id: 'D1', sourceId: 'original-id', content: '铁盐沉淀\n可以去除砷。', excerpts: [{ id: 'E1', text: '铁盐沉淀\n可以去除砷。' }] }] }
  const value = { grades: [{ id: 'D1', grade: '2', reason: '给出方法', quoteId: 'E1' }], coverage: [{ point: '0', ids: ['D1'] }], sufficiency: '具备方法依据' }
  const parsed = validateJudge(JSON.stringify(value), input)
  assert.equal(parsed.grades[0].id, 'original-id')
  assert.equal(parsed.grades[0].quote, input.results[0].content)
  assert.equal(parsed.coverage[0].ids[0], 'original-id')
  delete value.grades[0].quoteId
  value.grades[0].quote = 'E1'
  assert.equal(validateJudge(JSON.stringify(value), input).grades[0].quote, input.results[0].content)
  value.grades[0].quote = '铁盐沉淀 可以去除砷。'
  assert.equal(validateJudge(JSON.stringify(value), input).grades[0].grade, 2)
  value.grades[0].quote = '任何废水都能完全净化'
  assert.throws(() => validateJudge(JSON.stringify(value), input), /引文不是原文/)
  value.grades[0].quoteId = 'E99'
  assert.throws(() => validateJudge(JSON.stringify(value), input), /引文编号不存在/)
  value.grades[0].id = 'D99'
  assert.throws(() => validateJudge(JSON.stringify(value), input), /资料 ID/)
  assert.throws(() => validateJudge('null', input), /grades/)
})
const { normalizeEvidence, evaluate, summarize, validateCase } = require('../web-admin/server/utils/ragEvaluation')
const make = (overrides = {}) => ({ k: 5, latencyMs: 100, results: [{ evaluationId: 'a' }, { evaluationId: 'b' }, { evaluationId: 'c' }],
  testCase: { referencesComplete: true, references: [{ id: 'a', grade: 2 }, { id: 'b', grade: 1 }, { id: 'd', grade: 2 }], evidencePoints: ['条件', '效果'], noAnswer: false }, ...overrides })

test('抽查队列区分低分、部分复核、重评和中断状态', () => {
  const run = make()
  assert.equal(reviewQueueEntry(run).status, 'unjudged')
  run.judge = { id: 'judge-1', grades: ['a', 'b', 'c'].map(id => ({ id, grade: 1 })), coverage: [] }
  let row = reviewQueueEntry(run)
  assert.equal(row.status, 'pending')
  assert.equal(row.aiScore, 0.5)
  assert.equal(row.priority, true)
  assert.ok(row.reasons.includes('缺少直接支撑证据'))
  run.review = { judgeId: 'judge-1', grades: { a: 2 }, coveredPoints: [] }
  assert.equal(reviewQueueEntry(run).status, 'pending')
  run.review.grades = { a: 2, b: 1, c: 0 }
  assert.equal(reviewQueueEntry(run).status, 'reviewed')
  run.judge.id = 'judge-2'
  assert.equal(reviewQueueEntry(run).status, 'pending')
  run.judgeAttempt = { status: 'running', startedAt: new Date(Date.now() - 280000).toISOString() }
  assert.equal(reviewQueueEntry(run).status, 'failed')
  run.judgeAttempt.startedAt = new Date().toISOString()
  assert.equal(reviewQueueEntry(run).canJudge, false)
  run.error = 'timeout'
  assert.equal(reviewQueueEntry(run).status, 'blocked')
})

test('固定 K、完整金标准的召回、精度与排序指标', () => {
  const metrics = evaluate(make())
  assert.equal(metrics.precisionAtK, 2 / 5)
  assert.equal(metrics.recallAtK, 2 / 3)
  assert.equal(metrics.mrr, 1)
  const expected = (3 + 1 / Math.log2(3)) / (3 + 3 / Math.log2(3) + 1 / Math.log2(4))
  assert.ok(Math.abs(metrics.ndcgAtK - expected) < 1e-12)
  assert.equal(metrics.evidenceCoverage, null)
})
test('未知资料不能自动判错；模型初评不成为金标准', () => {
  const run = make({ testCase: { references: [{ id: 'a', grade: 2 }], referencesComplete: false }, judge: { grades: [{ id: 'b', grade: 2 }, { id: 'c', grade: 2 }] } })
  assert.equal(evaluate(run).precisionAtK, null)
  assert.equal(evaluate(run).recallAtK, null)
  assert.equal(evaluate(run).ndcgAtK, null)
  assert.equal(evaluate(run).mrr, null)
  run.review = { grades: { b: 1, c: 0 } }
  assert.equal(evaluate(run).precisionAtK, 2 / 5)
  assert.equal(evaluate(run).recallAtK, null)
})
test('人工覆盖率包含明确的零覆盖；未检查为未知', () => {
  assert.equal(evaluate(make({ review: { coveredPoints: [0] } })).evidenceCoverage, 0.5)
  assert.equal(evaluate(make({ review: { coveredPoints: [] } })).evidenceCoverage, 0)
  assert.equal(evaluate(make({ review: { coveredPoints: null } })).evidenceCoverage, null)
})

test('重排冷却仍可评分，失败或不完整优先阻止计分', () => {
  const sourceInfo = { searchMode: 'knowledge', degraded: true,
    zhipu: { success: true, partialFailure: false, degraded: true, queryVariants: ['原问题', '扩展问题'], retrievalFallbacks: [{ reason: 'rerank_cooldown' }, { reason: 'rerank_cooldown' }] },
    neo4j: { success: false, skipped: true, reason: 'disabled' } }
  const run = make({ degraded: true, retrievalMode: 'knowledge', sourceInfo })
  assert.equal(evaluate(run).eligible, true)
  assert.equal(evaluate(run).precisionAtK, 0.4)
  assert.equal(evaluate(run).rerankMode, 'fallback_off')
  assert.match(evaluate(run).warning, /本次未重排/)
  assert.equal(summarize([run]).failed, 0)
  assert.equal(summarize([run]).rerankFallback, 1)
  const partial = structuredClone(run)
  partial.sourceInfo.zhipu.partialFailure = true
  assert.equal(evaluate(partial).eligible, false)
  assert.equal(evaluate(partial).precisionAtK, null)
  const graphFailure = structuredClone(run)
  graphFailure.retrievalMode = 'hybrid'
  graphFailure.sourceInfo.neo4j = { success: false, error: 'timeout' }
  assert.equal(evaluate(graphFailure).eligible, false)
  const unknown = structuredClone(run)
  unknown.sourceInfo.zhipu.retrievalFallbacks = [{ reason: 'unknown' }]
  assert.equal(evaluate(unknown).eligible, false)
  const mixed = structuredClone(run)
  mixed.sourceInfo.zhipu.retrievalFallbacks = [{ reason: 'rerank_unavailable' }]
  assert.equal(evaluate(mixed).eligible, true)
  assert.equal(evaluate(mixed).rerankMode, 'fallback_mixed')
})
test('失败和降级不能当成正确拒答或进入质量平均值', () => {
  const testCase = { noAnswer: true, referencesComplete: true, references: [] }
  const healthy = make({ results: [], testCase })
  assert.equal(evaluate(healthy).noAnswerCorrect, 1)
  assert.equal(evaluate(healthy).falseRecall, 0)
  for (const failure of [{ error: 'timeout' }, { degraded: true }]) {
    const metrics = evaluate({ ...healthy, ...failure })
    for (const key of ['precisionAtK', 'recallAtK', 'mrr', 'ndcgAtK', 'noAnswerCorrect', 'empty']) assert.equal(metrics[key], null)
  }
  const result = summarize([healthy, { ...healthy, error: 'timeout', latencyMs: 4000 }])
  assert.equal(result.noAnswerCorrect.samples, 1)
  assert.equal(result.noAnswerCorrect.value, 1)
  assert.equal(result.p95LatencyMs, 4000)
  assert.equal(result.failed, 1)
})
test('稳定证据 ID 与排名无关、文档不同分块不折叠', () => {
  const first = { id: 'neo4j_1', sourceType: 'neo4j', title: '关系', content: '同一条关系' }
  assert.equal(normalizeEvidence([first])[0].evaluationId, normalizeEvidence([{ ...first, id: 'neo4j_7' }])[0].evaluationId)
  assert.equal(normalizeEvidence([first, first]).length, 1)
  assert.equal(normalizeEvidence([{ documentId: 'a', content: '片段1' }, { documentId: 'a', content: '片段2' }]).length, 2)
  assert.notEqual(normalizeEvidence([{ chunkId: 'same' }], 'kb-a')[0].evaluationId, normalizeEvidence([{ chunkId: 'same' }], 'kb-b')[0].evaluationId)
})

test('知识库切换签名限定内容和有效期，跨部署包可验证', () => {
  const { signTuningRequest } = require('../web-admin/server/utils/ragTuningAuth')
  const { verifyTuningRequest } = require('../cloudfunctions/processKnowledge/lib/tuningAuth')
  const secret = 'test-only-signing-key-93b8b7cc20342a1e'
  const payload = { query: '问题', topK: 5, knowledgeId: 'kb-a' }
  const request = signTuningRequest(payload, secret, 1000000)
  const reordered = Object.fromEntries(Object.entries(request.payload).reverse())
  assert.deepEqual(verifyTuningRequest({ ...request, payload: reordered }, secret, 1000010), reordered)
  const oldVerifierSignature = require('crypto').createHmac('sha256', secret).update(`rag-tuning-search:v1\n${request.expiresAt}\n${JSON.stringify(request.payload)}`).digest('hex')
  assert.equal(request.signature, oldVerifierSignature)
  assert.deepEqual(verifyTuningRequest(request, secret, 1000010), payload)
  assert.throws(() => verifyTuningRequest({ ...request, payload: { ...payload, knowledgeId: 'kb-private' } }, secret, 1000010), /签名/)
  assert.throws(() => verifyTuningRequest(request, secret, 1200000), /失效/)
  assert.throws(() => verifyTuningRequest(request, 'short', 1000010), /密钥/)
  assert.throws(() => verifyTuningRequest({ ...request, expiresAt: 9999999 }, secret, 1000010), /失效/)
})

test('真实混合检索只接收签名覆盖 ID，并传播配置快照与部分失败', async () => {
  const fs = require('fs')
  const path = require('path')
  const vm = require('vm')
  const { createRequire } = require('module')
  const { signTuningRequest } = require('../web-admin/server/utils/ragTuningAuth')
  const filename = path.resolve(__dirname, '../cloudfunctions/processKnowledge/handlers/hybridRag.js')
  const localRequire = createRequire(filename)
  const config = { zhipu: { useZhipuKb: true }, context: { minScore: 0, maxChunks: 4, maxTokens: 2000 }, graph: { enabled: false, maxFacts: 20, contextMaxTokens: 800 } }
  const secret = 'test-cloud-handler-shared-secret-cf746a63'
  const calls = []
  const mocks = {
    '../config': { zhipu: { knowledgeId: 'kb-default' }, neo4j: {} },
    '../lib/ragConfig': { getRagConfig: async () => config },
    '../lib/zhipuClient': {}, './neo4jGraph': {},
    './zhipuKb': { handleZhipuKBSearch: async (...args) => { calls.push(args); return { success: true, results: [], partialFailure: true } } }
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: name => mocks[name] || localRequire(name), process: { env: { RAG_TUNING_SHARED_SECRET: secret } }, console, setTimeout, clearTimeout }, { filename })
  const normal = await module.exports.handleHybridSearch({ query: '问题', knowledgeId: 'unauthorized-override' }, {})
  assert.equal(normal.knowledgeBase.id, 'kb-default')
  assert.equal(calls[0][3], undefined)
  const signed = signTuningRequest({ query: '问题', topK: 5, knowledgeId: 'kb-other' }, secret)
  const result = await module.exports.handleTuningSearch(signed, {})
  assert.equal(calls[1][3], 'kb-other')
  assert.equal(calls[1][2], result.effectiveConfig)
  assert.notEqual(result.effectiveConfig, config)
  assert.equal(result.effectiveConfig.graph.enabled, false)
  assert.equal(result.retrievalMode, 'knowledge')
  assert.equal(result.sourceInfo.neo4j.debug.status, 'disabled')
  assert.equal(result.knowledgeBase.id, 'kb-other')
  assert.equal(result.sourceInfo.degraded, true)
  await assert.rejects(() => module.exports.handleTuningSearch({ ...signed, payload: { ...signed.payload, knowledgeId: 'tampered' } }, {}), /签名/)
  assert.equal(calls.length, 2)
  const graph = await module.exports.handleTestSearch({ query: '问题', retrievalMode: 'graph' }, {})
  assert.equal(calls.length, 2, 'graph-only must not invoke document retrieval')
  assert.equal(graph.sourceInfo.zhipu.skipped, true)
  assert.equal(graph.sourceInfo.neo4j.debug.status, 'not_configured')
  assert.equal(graph.effectiveConfig.graph.enabled, true)
  assert.equal(config.graph.enabled, false, 'test must not mutate cached config')
  const mixed = await module.exports.handleTestSearch({ query: '问题', retrievalMode: 'hybrid' }, {})
  assert.equal(calls.length, 3)
  assert.equal(mixed.sourceInfo.neo4j.debug.status, 'not_configured')
})
test('拒绝矛盾、重复或不合法的金标准', () => {
  const base = { query: '问题', references: [], evidencePoints: [], noAnswer: null, referencesComplete: false }
  assert.equal(validateCase(base).noAnswer, null)
  assert.throws(() => validateCase({ ...base, noAnswer: true, references: [{ id: 'a', grade: 2 }] }), /无答案/)
  assert.throws(() => validateCase({ ...base, references: [{ id: 'a', grade: 1 }, { id: 'a', grade: 2 }] }), /重复/)
  assert.throws(() => validateCase({ ...base, references: [{ id: 'a', grade: '2' }] }), /等级/)
})
const { reviewQueueEntry } = require('../web-admin/server/utils/ragReviewQueue')
