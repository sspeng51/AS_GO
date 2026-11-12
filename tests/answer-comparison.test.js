const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./fixtures/rag-tuning-harness')
const { validateAnswerJudge } = require('../web-admin/server/utils/answerComparison')

test('5.3含Flash在生成或评审均使用low，4.7仍可关闭思考', () => {
  const { modelThinking } = require('../web-admin/server/utils/modelThinking')
  for (const model of ['glm-5.3','glm-5.3-flash']) {
    assert.deepEqual(modelThinking({model,thinking:'disabled'}), {thinking:{type:'enabled'},reasoning_effort:'low'})
  }
  assert.deepEqual(modelThinking({model:'glm-4.7',thinking:'disabled'}), {thinking:{type:'disabled'}})
  const { modelError } = require('../web-admin/server/utils/ragServiceError')
  const error = modelError({response:{status:400,data:{error:{code:'1210',message:'该模型始终思考，不支持关闭思考 secret-key'}}}})
  assert.match(error.message,/不支持关闭思考/)
  assert.ok(!error.message.includes('secret-key'))
})
test('按题7次调用：隔离生成、随后标准制定与集中评审，恢复不重复消费', async t => {
  const { http, token, state, tables } = createHarness()
  const server = http.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests`
  async function req(path, body, role = 'admin') {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(role)}` }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, data: await response.json() }
  }
  const input = { query: '含砷废水如何处理？', judgeModel: 'glm-4.7', generation: { model: 'glm-5.3', systemPrompt: '不得使用这个自定义模板' } }
  assert.equal((await req('', input, 'viewer')).status, 403)
  const created = await req('', input); assert.equal(created.status, 200)
  const id = created.data.experiment._id
  assert.equal(created.data.experiment.generation.systemPrompt, require('../config/answerPrompt').systemPrompt)
  assert.equal(created.data.experiment.prices, undefined)
  let run = (await req(`/${id}/prepare`, {})).data.experiment
  assert.equal(state.modelCalls.length, 0)
  assert.equal((await req(`/${id}/rubric`, {})).status, 400)
  assert.equal(run.documents.length, 1); assert.equal(run.graph.length, 1); assert.ok(run.expert.context)
  state.modelDelayMs = 10
  run = (await req(`/${id}/generate`, {})).data.experiment
  assert.equal(state.peakModels, 3)
  assert.equal(run.calls.length, 5)
  for (const [key, variant] of Object.entries(run.variants)) {
    const time = variant.timings
    assert.equal(time.totalMs, time.modelMs + time.documentMs + time.graphMs + time.expertMs)
    assert.equal(time.modelMs, run.calls.find(c => c.stage === `generate:${key}`).latencyMs)
    assert.equal(time.documentMs, key === 'A' ? 0 : run.retrievalCalls.filter(c => c.mode === 'knowledge').reduce((n,c) => n+c.latencyMs,0))
    assert.equal(time.graphMs, ['C','E'].includes(key) ? run.retrievalCalls.filter(c => c.mode === 'graph').reduce((n,c) => n+c.latencyMs,0) : 0)
    assert.equal(variant.thinking, 'enabled')
    assert.equal(variant.reasoningEffort, 'low')
  }
  assert.deepEqual(Object.keys(run.variants).sort(), ['A','B','C','D','E'])
  for (const key of ['A','B','C','D','E']) {
    assert.equal(run.variants[key].sources.some(s => s.id === 'D1'), key !== 'A')
    assert.equal(run.variants[key].sources.some(s => s.id === 'G1'), ['C','E'].includes(key))
    assert.equal(run.variants[key].expertApplied, ['D','E'].includes(key))
  }
  assert.equal(state.modelCalls.filter(c => c.messages[0].content.includes('【冶金砷专家回答规范')).length, 2)
  assert.ok(state.modelCalls.every(c => c.model === 'glm-5.3' && c.thinking.type === 'enabled' && c.reasoning_effort === 'low'))
  await req(`/${id}/rubric`, {})
  assert.equal(state.modelCalls.length, 6)
  assert.equal(JSON.parse(state.modelCalls.at(-1).messages[1].content).answer, undefined)
  run = (await req(`/${id}/judge`, {})).data.experiment
  assert.equal(run.calls.length, 7)
  assert.deepEqual(state.modelCalls.at(-1).response_format, { type: 'json_object' })
  assert.equal(state.modelCalls.at(-1).temperature, 0.2)
  assert.equal(run.calls.at(-1).responseFormat, 'json_object')
  assert.equal(state.modelCalls.at(-1).model, 'glm-4.7')
  assert.equal(state.modelCalls.at(-1).thinking.type, 'disabled')
  assert.equal(JSON.parse(state.modelCalls.at(-1).messages[1].content).answers.length, 5)
  assert.ok(run.calls.every(c => c.cost === undefined))
  assert.equal(run.calls.reduce((n,c) => n+c.usage.total_tokens,0),700)
  assert.ok(Object.values(run.variants).every(v => v.judge.metrics.professionalCorrectness.value === 1))
  for (const path of ['prepare','generate','rubric','judge']) await req(`/${id}/${path}`, {})
  assert.equal(state.modelCalls.length, 7)
  // Reparse the raw saved response without charging for another model request.
  const stored = tables.get('rag_answer_experiments').get(id)
  delete stored.variants.E.judge
  stored.variants.E.error = '遗漏回答中的引用'
  run = (await req(`/${id}/repair`, {})).data.experiment
  assert.equal(run.variants.E.judge.recoveredLocally, true)
  assert.equal(state.modelCalls.length, 7)
  const second = (await req('', input)).data.experiment
  for (const path of ['prepare','generate','rubric']) await req(`/${second._id}/${path}`, {})
  state.invalidBatchOnce = true
  assert.equal((await req(`/${second._id}/judge`, {})).status, 200)
  run = (await req(`/${second._id}`)).data.experiment
  assert.equal(run.calls.length, 8)
  assert.equal(Object.values(run.variants).filter(v => v.judge).length, 5)
  assert.equal(Object.values(run.variants).filter(v => v.judge.status === 'partial').length, 0)
  run = (await req(`/${second._id}/judge`, {})).data.experiment
  assert.equal(run.calls.length, 8)
  assert.equal(JSON.parse(state.modelCalls.at(-1).messages[1].content).answers.length, 1)
  assert.ok(Object.values(run.variants).every(v => v.judge && v.judge.status !== 'partial'))
  assert.equal(run.calls.at(-1).attempt, 2)
  const priorAnswers = Object.fromEntries(Object.entries(run.variants).map(([key,v])=>[key,v.answer]))
  const beforeUpgrade = state.modelCalls.length
  await req(`/${second._id}/judge-model`, {judgeModel:'glm-4.7',upgradeStandard:true})
  await req(`/${second._id}/rubric`, {})
  run = (await req(`/${second._id}/judge`, {})).data.experiment
  assert.equal(state.modelCalls.length, beforeUpgrade + 2)
  assert.deepEqual(Object.fromEntries(Object.entries(run.variants).map(([key,v])=>[key,v.answer])),priorAnswers)
  assert.ok(run.variants.A.judgeHistory.length)
  delete tables.get('rag_answer_experiments').get(second._id).scoringVersion
  const beforeAutomaticUpgrade = state.modelCalls.length
  run = (await req(`/${second._id}/judge`, {})).data.experiment
  assert.equal(run.scoringVersion, 'analytic-100-v2')
  assert.equal(state.modelCalls.length, beforeAutomaticUpgrade + 2)
  assert.deepEqual(Object.fromEntries(Object.entries(run.variants).map(([key,v])=>[key,v.answer])),priorAnswers)
  await req(`/${second._id}/judge`, {})
  assert.equal(state.modelCalls.length, beforeAutomaticUpgrade + 2)
  const configurable = (await req('', {query:'模型选择测试',generation:{model:'glm-4.7-flash'},judgeModel:'glm-5.3-flash'})).data.experiment
  assert.equal(configurable.generation.model,'glm-4.7-flash')
  assert.equal(configurable.judgeModel,'glm-5.3-flash')
  assert.equal((await req('', {query:'禁止未知模型',generation:{model:'unknown'}})).status,400)
})

test('评审校验原文、重复点和虚构引用', () => {
  const answer = '吸附处理需确定pH。[D9]'
  const rubric = { points: ['方法'], conditions: ['pH'] }
  const value = { claims: [{ quote: answer, correct: true, supported: false, citedIds: ['D9'], citationSupported: true, reason: '编号不存在' }], conditions: [{ point: 0, applicable: null, reason: '未知' }], coverage: [{ point: 0, covered: true, quote: answer, reason: '方法' }] }
  const result = validateAnswerJudge(structuredClone(value), answer, rubric, [])
  assert.equal(result.metrics.citationSupport.value, 0); assert.equal(result.metrics.unsupportedConclusions.value, 1); assert.equal(result.metrics.conditionApplicability.value, null)
  value.claims[0].quote = '编造的原文'; assert.throws(() => validateAnswerJudge(value, answer, rubric, []))
})

test('汇总逐题等权，缺失评审与截断答案排除', async () => {
  const { answerReport } = await import('../web-admin/client/src/views/tuning/answerMetrics.mjs')
  const make = value => ({ knowledgeId: 'x', k: 5, generation: { model: 'm' }, judgeModel: 'j', prices: {}, calls: [], variants: Object.fromEntries(['A','B','C','D','E'].map(key => [key, { judge: { metrics: { professionalCorrectness: { value } } }, finishReason: 'stop' }])) })
  const first = make(1), second = make(0)
  assert.equal(answerReport([first, second])[0].metrics.professionalCorrectness.value, 0.5)
  second.variants.E.finishReason = 'length'
  assert.equal(answerReport([first, second])[0].metrics.professionalCorrectness.samples, 1)
  assert.equal(answerReport([first, second], false)[0].metrics.professionalCorrectness.samples, 2)
  second.variants.E.finishReason = 'stop'
  second.variants.E.judge.metrics.professionalCorrectness.value = null
  assert.ok(answerReport([first, second], true).every(row => row.metrics.professionalCorrectness.samples === 1))
})

test('评审使用片段编号还原原文，并拒绝虚构片段', () => {
  const answer = '吸附处理需确定pH。[D1]'
  const rubric = { points: ['方法'], conditions: ['pH'] }
  const sources = [{ id: 'D1', content: '吸附效果受pH影响。' }]
  const value = { claims: [{ quoteId: 'A1', correct: true, supported: true, citedIds: ['D1'], citationSupported: true, sourceQuotes: [{ id: 'D1', quoteId: 'D1:1' }], reason: '有资料支持' }], conditions: [{ point: 0, applicable: true, quoteId: 'A1', reason: '提到pH' }], coverage: [{ point: 0, covered: true, quoteId: 'A1', reason: '覆盖方法' }] }
  const result = validateAnswerJudge(structuredClone(value), answer, rubric, sources)
  assert.equal(result.claims[0].quote, '吸附处理需确定pH。')
  assert.equal(result.claims[0].sourceQuotes[0].quote, sources[0].content)
  assert.equal(result.metrics.citationSupport.value, 1)
  value.claims[0].quoteId = 'A999'
  assert.throws(() => validateAnswerJudge(value, answer, rubric, sources), /未知回答片段/)
})

test('两题任务并发执行且不超过两个，停止后不领取后续题目', async () => {
  const { runQuestionQueue, createRequestGate } = await import('../web-admin/client/src/views/tuning/answerExecution.mjs')
  let active = 0, peak = 0, stop = false
  const done = []
  await runQuestionQueue([1, 2, 3, 4], async n => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    done.push(n); stop = true; active--
  }, () => stop)
  assert.equal(peak, 2); assert.deepEqual(done.sort(), [1, 2])
  const waits = [], gate = createRequestGate(2200, () => 100, async ms => { waits.push(ms) })
  await Promise.all([gate(), gate(), gate()])
  assert.deepEqual(waits, [2200, 4400])
})

test('图谱独立检索：暂时超时仅重试一次，空结果明确标记，恢复后旧评分归档', async t => {
  const { http, token, state, tables } = createHarness()
  const server = http.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests`
  async function post(path, body = {}) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token('admin')}` }, body: JSON.stringify(body) })
    assert.equal(response.status, 200); return (await response.json()).experiment
  }
  const input = { query: '含砷废水', knowledgeId: 'fixture-kb', judgeModel: 'glm-4.7', generation: { model: 'glm-5.3' } }
  const run = await post('', input)
  state.graphTimeouts = 1
  const ready = await post(`/${run._id}/prepare`)
  assert.equal(ready.graph.length, 1)
  assert.deepEqual(state.cloudCalls.map(c => (c.data.data.payload || c.data.data).retrievalMode), ['knowledge', 'graph', 'graph'])
  assert.equal(state.cloudCalls[1].data.data.knowledgeId, undefined)
  assert.equal(state.cloudCalls[1].data.action, 'rag.test.search')
  const empty = await post('', { ...input, query: '无答案' })
  const emptyReady = await post(`/${empty._id}/prepare`)
  assert.equal(emptyReady.graphEmpty, true); assert.deepEqual(emptyReady.graph, [])
  const partial = await post('', input)
  state.graphTimeouts = 2
  const failed = await post(`/${partial._id}/prepare`)
  assert.equal(failed.graph, undefined); assert.ok(failed.graphError)
  await post(`/${partial._id}/generate`)
  await post(`/${partial._id}/rubric`)
  await post(`/${partial._id}/judge`)
  const stored = tables.get('rag_answer_experiments').get(partial._id)
  assert.equal(stored.variants.A.judge.evidenceScope, 'documents_only')
  const recovered = await post(`/${partial._id}/prepare`)
  assert.equal(recovered.variants.A.judge, undefined)
  assert.equal(recovered.variants.A.judgeHistory.length, 1)
  assert.ok(recovered.variants.A.answer)
})


test('共享原文允许不同结论；完全重复结论去重，矛盾评分仍拒绝', () => {
  const answer = '吸附前需要测pH，并检查砷形态。'
  const value = { claims: [
    { statement: '需要测pH', quoteId: 'A1', correct: true, supported: true, citedIds: [], citationSupported: null, reason: '理由' },
    { statement: '检查砷形态', quoteId: 'A1', correct: false, supported: false, citedIds: [], citationSupported: null, reason: '理由' }
  ], conditions: [{ point: 0, applicable: true, quoteId: 'A1', reason: '工况' }], coverage: [{ point: 0, covered: true, quoteId: 'A1', reason: '覆盖' }] }
  const rubric = { conditions: ['条件'], points: ['方法'] }
  value.claims.push(structuredClone(value.claims[0]))
  const result = validateAnswerJudge(structuredClone(value), answer, rubric, [])
  assert.equal(result.claims.length, 2)
  assert.equal(result.metrics.professionalCorrectness.value, 0.5)
  value.claims[2].correct = false
  assert.throws(() => validateAnswerJudge(value, answer, rubric, []), /矛盾/)
})


test('评分按维度恢复：漏引用、缺工况、空片段编号不丢掉其他有效指标', () => {
  const { recoverAnswerJudge } = require('../web-admin/server/utils/answerJudgeRecovery')
  const answer = '吸附前需要测pH。[D2]'
  const value = { claims: [{ statement: '需要测pH', quoteId: '', quote: '吸附前需要测pH。', correct: true, supported: true, citedIds: [], citationSupported: null, reason: '依据' }], conditions: [], coverage: [{ point: 1, covered: true, quoteId: '', quote: '吸附前需要测pH。', reason: '覆盖' }] }
  const result = recoverAnswerJudge(value, answer, { points: ['方法'], conditions: ['pH'] }, [{ id: 'D2', content: '吸附受pH影响' }])
  assert.equal(result.status, 'partial')
  assert.equal(result.metrics.professionalCorrectness.value, 1)
  assert.equal(result.metrics.answerCoverage.value, 1)
  assert.equal(result.metrics.conditionApplicability.value, null)
  assert.equal(result.metrics.citationSupport.value, null)
  assert.ok(result.warnings.some(w => w.includes('D2')))
  assert.equal(result.metrics.conditionApplicability.complete, false)
})

test('主表Token跨组与共享调用不重计，未返回usage保持未知', async () => {
  const { answerTable } = await import('../web-admin/client/src/views/tuning/answerMetrics.mjs')
  const run = { knowledgeId: 'kb', k: 5, generation: {}, judgeModel: 'glm-4.7', variants: {}, calls: ['generate:A','generate:B','generate:C','generate:D','generate:E','rubric','judge:batch'].map(stage => ({ stage, usage: { total_tokens: 100 } })) }
  const rows = answerTable([run], false)
  assert.equal(rows.length, 6)
  assert.equal(rows.reduce((n,r) => n+r.tokens,0), 700)
  assert.equal(rows.at(-1).tokens, 200)
  run.calls[6].usage = null
  assert.equal(answerTable([run], false).at(-1).tokens, null)
})

test('后台百题批次一次提交即执行，700次模型调用且报告快照有界', async t => {
  const { http, token, state } = createHarness()
  const server = http.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests/batches`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token('admin')}` }
  const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ queries: Array.from({length:100}, (_,i)=>`含砷废水问题${i}`) }) })
  assert.equal(response.status, 202)
  let job = (await response.json()).batch
  const started = Date.now()
  while (!['completed','completed_with_errors','paused'].includes(job.status) && Date.now()-started < 60000) {
    await new Promise(resolve => setTimeout(resolve, 40))
    job = (await (await fetch(`${base}/${job._id}`, { headers })).json()).batch
  }
  assert.equal(job.status, 'completed', job.lastError)
  assert.equal(Object.keys(job.summaries).length, 100)
  assert.equal(state.modelCalls.length, 700)
  assert.ok(Buffer.byteLength(JSON.stringify(job)) < 1000000)
  const initialCalls = state.modelCalls.length
  await fetch(`${base}/${job._id}/resume`, {method:'POST', headers})
  assert.equal(state.modelCalls.length, initialCalls)
})

test('后台批次在生成阶段后暂停，恢复复用五组答案且不重复调用', async t => {
  const { http, token, state } = createHarness()
  state.modelDelayMs = 70
  const server = http.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests/batches`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token('admin')}` }
  let job = (await (await fetch(base, { method: 'POST', headers, body: JSON.stringify({ queries: ['暂停恢复测试问题'] }) })).json()).batch
  const deadline = Date.now() + 10000
  while (!state.modelCalls.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(state.modelCalls.length > 0)
  assert.equal((await fetch(`${base}/${job._id}/pause`, { method: 'POST', headers })).status, 200)
  async function waitStatus(status) {
    while (job.status !== status && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 15))
      job = (await (await fetch(`${base}/${job._id}`, { headers })).json()).batch
    }
    assert.equal(job.status, status)
  }
  await waitStatus('paused')
  assert.equal(state.modelCalls.length, 5)
  assert.equal(Object.values(job.summaries[0].variants).filter(v => v.hasAnswer).length, 5)
  assert.equal(job.pending.length, 1)
  assert.equal((await fetch(`${base}/${job._id}/resume`, { method: 'POST', headers })).status, 200)
  await waitStatus('completed')
  assert.equal(state.modelCalls.length, 7)
  assert.equal(job.pending.length, 0)
})

test('批次图谱失败仍保存文档组，恢复时仅补生成C/E并更新统一评审', async t => {
  const { http, token, state } = createHarness()
  state.graphTimeouts = 2
  const server = http.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests/batches`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token('admin')}` }
  let job = (await (await fetch(base, {method:'POST',headers,body:JSON.stringify({queries:['图谱临时超时测试']})})).json()).batch
  async function waitFor(status) {
    const deadline = Date.now() + 10000
    while (job.status !== status && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 15))
      job = (await (await fetch(`${base}/${job._id}`, {headers})).json()).batch
    }
    assert.equal(job.status, status)
  }
  await waitFor('completed_with_errors')
  assert.deepEqual(job.failures,[0])
  assert.equal(state.modelCalls.length,5)
  await fetch(`${base}/${job._id}/resume`, {method:'POST',headers})
  await waitFor('completed')
  assert.equal(state.modelCalls.length,8)
  assert.equal(state.modelCalls.filter(c=>c.model === 'glm-5.3').length,5)
  assert.equal(Object.values(job.summaries[0].variants).filter(v=>v.judge).length,5)
})

test('分级标准支持部分正确与部分覆盖，缺失分数不能转成满分', () => {
  const { recoverAnswerJudge } = require('../web-admin/server/utils/answerJudgeRecovery')
  const answer = '需要评估pH和砷形态。'
  const rubric = {points:['解释方法'],conditions:['工况限制']}
  const input = {claims:[{quote:answer,score:3,correct:false,supported:true,citedIds:[],citationSupported:null,reason:'基本正确'}],conditions:[{point:0,score:2,applicable:true,quote:answer,reason:'适配不完整'}],coverage:[{point:0,score:1,covered:true,quote:answer,reason:'仅提及'}]}
  const result = recoverAnswerJudge(input,answer,rubric,[],'anchored-v1')
  assert.equal(result.metrics.professionalCorrectness.value,0.75)
  assert.equal(result.metrics.conditionApplicability.value,0.5)
  assert.equal(result.metrics.answerCoverage.value,0.25)
  delete input.conditions[0].score
  assert.equal(recoverAnswerJudge(input,answer,rubric,[],'anchored-v1').metrics.conditionApplicability.value,null)
})

test('有依据指标兼容历史，未知仍为空，逐题分析不再含增益', async () => {
  const {questionAnalysis,metricFor,answerReport} = await import('../web-admin/client/src/views/tuning/answerMetrics.mjs')
  const variant = {judge:{metrics:{unsupportedConclusions:{value:0.2,numerator:1,denominator:5}}}}
  assert.equal(metricFor(variant,'supportedConclusions').value,0.8)
  assert.equal(metricFor(variant,'supportedConclusions').numerator,4)
  const run={_id:'one',query:'问题',generation:{},calls:[],variants:{A:variant}}
  assert.equal(answerReport([run],false)[0].metrics.supportedConclusions.value,0.8)
  const analysis=questionAnalysis([run])
  assert.equal(analysis[0].gains,undefined)
  assert.equal(analysis[0].rows[0].questionMetrics[0].supportedConclusions.value,0.8)
  variant.judge.metrics.unsupportedConclusions.value=null
  assert.equal(metricFor(variant,'supportedConclusions').value,null)
})

test('同批两库两题按库保存与分组，模型使用所选配置', async t => {
  const {http,token,state,tables} = createHarness()
  const server=http.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close())
  const base=`http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests/batches`
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${token('admin')}`}
  const response=await fetch(base,{method:'POST',headers,body:JSON.stringify({queries:['问题1','问题2'],knowledgeIds:['kb-one','kb-two'],generation:{model:'glm-4.7-flash'},judgeModel:'glm-5.3-flash'})})
  assert.equal(response.status,202)
  let job=(await response.json()).batch
  const deadline=Date.now()+10000
  while(job.status!=='completed'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,15));job=(await(await fetch(`${base}/${job._id}`,{headers})).json()).batch}
  assert.equal(job.status,'completed')
  assert.deepEqual(Object.values(job.summaries).map(r=>r.knowledgeId),['kb-one','kb-one','kb-two','kb-two'])
  assert.equal(state.modelCalls.length,28)
  assert.ok(Object.values(job.summaries).every(run => Object.values(run.variants).every(v => Number.isFinite(v.timings.totalMs))))
  assert.equal(state.modelCalls.filter(c=>c.model==='glm-4.7-flash').length,20)
  assert.equal(state.modelCalls.filter(c=>c.model==='glm-5.3-flash').length,8)
  const {questionAnalysis}=await import('../web-admin/client/src/views/tuning/answerMetrics.mjs')
  const analysis=questionAnalysis(Object.values(job.summaries).map(run=>({...job.settings,...run})))
  assert.equal(analysis.length,2)
  assert.ok(analysis.every(group=>group.questions.length===2))
  const storedJob=tables.get('rag_answer_batches').get(job._id)
  delete storedJob.summaries[0].scoringVersion
  delete tables.get('rag_answer_experiments').get(job.ids[0]).scoringVersion
  const resumed=await fetch(`${base}/${job._id}/resume`,{method:'POST',headers})
  job=(await resumed.json()).batch
  while(job.status!=='completed'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,15));job=(await(await fetch(`${base}/${job._id}`,{headers})).json()).batch}
  assert.equal(job.status,'completed')
  assert.equal(job.summaries[0].scoringVersion,'analytic-100-v2')
  assert.equal(state.modelCalls.length,30)
  assert.equal(state.modelCalls.filter(c=>c.model==='glm-4.7-flash').length,20)
})

test('Excel完整报告包含数值、调用、原始记录且文本不作为公式执行', async () => {
  const {buildAnswerSheets,exportAnswerWorkbook} = await import('../web-admin/client/src/views/tuning/answerExport.mjs')
  const run={_id:'export-case',query:'=HYPERLINK("bad")',generation:{model:'g'},judgeModel:'j',scoringVersion:'anchored-v1',variants:{A:{answer:'长文😀'.repeat(12000),judge:{metrics:{professionalCorrectness:{value:0.75},unsupportedConclusions:{value:0.25,numerator:1,denominator:4}},claims:[{quote:'原文',reason:'依据'}]}}},calls:[{stage:'generate:A',usage:{total_tokens:150},latencyMs:23},{stage:'judge:batch',usage:{total_tokens:250}}]}
  const sheets=buildAnswerSheets([run],false)
  assert.equal(sheets[0].rows[1][4].value,3)
  assert.equal(sheets[0].rows[1][10].value,0.75)
  assert.deepEqual(JSON.parse(sheets[6].rows.slice(1).map(row=>row[3]).join('')),run)
  const bytes=exportAnswerWorkbook([run],false), entries=new Map()
  const view=new DataView(bytes.buffer);let at=0
  while(view.getUint32(at,true)===0x04034b50){const length=view.getUint32(at+18,true),n=view.getUint16(at+26,true),e=view.getUint16(at+28,true);const name=new TextDecoder().decode(bytes.slice(at+30,at+30+n));const start=at+30+n+e;entries.set(name,new TextDecoder().decode(bytes.slice(start,start+length)));at=start+length}
  assert.ok(entries.get('xl/workbook.xml').includes('长文本'))
  assert.ok(entries.get('xl/worksheets/sheet1.xml').includes('<v>3</v>'))
  assert.ok(entries.get('xl/worksheets/sheet3.xml').includes('t="inlineStr"'))
  assert.ok(![...entries.values()].some(text=>text.includes('<f>')))
  assert.ok(entries.get('xl/worksheets/sheet7.xml').includes('export-case'))
})

test('Y轴缩放包含全部数据、空值不补零，完整范围可恢复', async () => {
  const { chartDomain } = await import('../web-admin/client/src/views/tuning/answerChartScale.mjs')
  for (const values of [[0.91,0.92,0.94,null], [1,1], [0,0], [0,1], [0.75], [null]]) {
    const domain = chartDomain(values)
    assert.ok(domain.max > domain.min)
    for (const value of values.filter(Number.isFinite)) assert.ok(value >= domain.min && value <= domain.max)
  }
  assert.ok(chartDomain([0.91,0.92,0.94]).min > 0.8)
  assert.deepEqual(chartDomain([0.91,0.94], true, false), {min:0,max:1})
  assert.deepEqual(chartDomain([null]), {min:0,max:1})
  const latency = chartDomain([20000,21000], false)
  assert.ok(latency.min > 0 && latency.min < 20000 && latency.max > 21000)
})

test('耗时按完整逐题快照平均，历史缺项排除，Excel保留分项', async () => {
  const { answerReport } = await import('../web-admin/client/src/views/tuning/answerMetrics.mjs')
  const { buildAnswerSheets } = await import('../web-admin/client/src/views/tuning/answerExport.mjs')
  const run = { _id:'timing', query:'q', variants:{B:{answer:'a',thinking:'disabled',timings:{modelMs:100,documentMs:20,graphMs:0,expertMs:0,totalMs:120}}}, calls:[{stage:'generate:B',latencyMs:100}] }
  const history = {...run, variants:{B:{answer:'old'}}}
  const rows = answerReport([run,history],false)
  assert.equal(rows.find(r=>r.group==='B').generationMs,120)
  assert.equal(rows.find(r=>r.group==='B').timingSamples,1)
  assert.equal(rows.find(r=>r.group==='A').generationMs,null)
  const sheet = buildAnswerSheets([run],false)[1]
  const row = sheet.rows.find(r=>r[3]==='B 文档 RAG')
  assert.equal(row[sheet.rows[0].indexOf('检索＋生成耗时ms')],120)
  assert.equal(row[sheet.rows[0].indexOf('文档检索ms')],20)
  assert.equal(row[sheet.rows[0].indexOf('思考模式')],'disabled')
})
