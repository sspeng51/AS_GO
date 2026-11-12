const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./fixtures/rag-tuning-harness')

test('89条评分加11条失败，共同问题筛选仍保留已完成成绩',async()=>{
 const {buildReport}=await import('../web-admin/client/src/views/tuning/quickMetrics.mjs')
 const rows=Array.from({length:100},(_,i)=>({query:`Q${i}`,k:5,targetId:'kb',metrics:{eligible:true,rerankMode:'enabled'},results:[{evaluationId:'d'}],...(i<89?{judge:{model:'glm-4.7',version:'retrieval-judge-v4',grades:[{id:'d',grade:2,relevanceScore:81}]}}:{judgeAttempt:{status:'failed'}})}))
 const report=buildReport(rows,{precisionAtK:'P',contextRelevance:'C'}, {},'model',true)
 assert.equal(report.length,1);assert.equal(report[0].metrics.precisionAtK.samples,89);assert.ok(Math.abs(report[0].metrics.contextRelevance.value-.81)<1e-12)
 const other=rows.map(r=>({...r,targetId:'kb2',judge:undefined,judgeAttempt:{status:'failed'}}))
 const paired=buildReport([...rows,...other],{precisionAtK:'P'}, {},'model',true)
 assert.ok(paired.every(g=>g.metrics.precisionAtK.samples===0))
})

test('分项相加与多片段引用校验，不能借其他资料的编号',()=>{
 const {validateJudge}=require('../web-admin/server/utils/judgeValidation')
 const input={requireFine:true,requireBreakdown:true,evidencePoints:[],results:[{id:'D2',content:'第一条。第二条。第三条。',excerpts:[{id:'E1',text:'第一条。'},{id:'E3',text:'第三条。'}]}]}
 const raw={grades:[{id:'D2',breakdown:{directness:42,scope:21,detail:13},reason:'缺少限定条件',quoteIds:['D2:E1','E3']}],coverage:[],sufficiency:'部分支持'}
 const result=validateJudge(JSON.stringify(raw),input)
 assert.equal(result.grades[0].relevanceScore,76);assert.equal(result.grades[0].grade,2)
 raw.grades[0].quoteIds=['D1:E1'];assert.throws(()=>validateJudge(JSON.stringify(raw),input),/不存在/)
 raw.grades[0].quoteIds=['E1'];raw.grades[0].breakdown.directness=51;assert.throws(()=>validateJudge(JSON.stringify(raw),input),/分项/)
})

test('检索批次保存全部未开始任务，断点请求复用结果与评分',async t=>{
 const {http,token,state}=createHarness();const server=http.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close())
 const base=`http://127.0.0.1:${server.address().port}/api/rag-tuning`
 async function req(url,method='GET',body,role='admin'){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(role)}`},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
 const batch={k:5,judgeModel:'glm-4.7',runs:[{query:'问题1',targetId:'kb-one',requestId:'checkpoint-one'},{query:'问题2',targetId:'kb-one',requestId:'checkpoint-two'}]}
 assert.equal((await req('/retrieval-batches/checkpoint-batch','PUT',batch,'viewer')).status,403)
 assert.equal((await req('/retrieval-batches/checkpoint-batch','PUT',batch)).status,200)
 assert.equal((await req('/retrieval-batches/checkpoint-batch')).data.batch.runs.length,2)
 assert.equal((await req('/retrieval-batches')).data.batches.length,1)
 const body={query:'问题1',knowledgeId:'kb-one',requestId:'checkpoint-one',k:5,retrievalMode:'knowledge'}
 const first=await req('/retrieve','POST',body);assert.equal(first.status,200)
 assert.equal((await req('/retrieve','POST',body)).data.skipped,true);assert.equal(state.cloudCalls.length,1)
 assert.equal((await req('/retrieve','POST',{...body,query:'另一个问题'})).status,400)
 const assessed=await req('/runs/checkpoint-one/judge','POST',{model:'glm-4.7',skipExisting:true,autoEvidencePoints:true,autoReferencePool:true})
 assert.equal(assessed.status,200);assert.equal(assessed.data.judge.version,'retrieval-judge-v5')
 const before=state.modelCalls.length
 assert.equal((await req('/runs/checkpoint-one/judge','POST',{skipExisting:true,autoEvidencePoints:true,autoReferencePool:true})).data.skipped,true)
 assert.equal(state.modelCalls.length,before)
 const {quickMetrics,buildReport}=await import('../web-admin/client/src/views/tuning/quickMetrics.mjs')
 assert.equal(quickMetrics(assessed.data.run,'model').contextRelevance.value,.85)
 const {retrievalSheets,exportRetrievalWorkbook}=await import('../web-admin/client/src/views/tuning/retrievalExport.mjs')
 const names={precisionAtK:'Precision',contextRelevance:'上下文相关性'},rows=[assessed.data.run],report=buildReport(rows,names,{},'model',false)
 const sheets=retrievalSheets(rows,report,names,'model',false)
 assert.equal(sheets[0].rows[1][7].value,85)
 assert.equal(sheets[1].rows[2][7].value,85)
 assert.deepEqual(JSON.parse(sheets[4].rows.slice(1).map(r=>r[2]).join('')),rows[0])
 assert.equal(exportRetrievalWorkbook(rows,report,names,'model',false)[0],0x50)
})

test('细评分需有原文且与等级一致，缺分不可伪装成完成',()=>{
 const {validateJudge}=require('../web-admin/server/utils/judgeValidation')
 const input={requireFine:true,evidencePoints:[],results:[{id:'D1',content:'支持问题的证据',excerpts:[{id:'E1',text:'支持问题的证据'}]}]}
 const raw={grades:[{id:'D1',grade:2,reason:'直接支持',quoteId:'E1',relevanceScore:85}],coverage:[],sufficiency:'足够'}
 assert.equal(validateJudge(JSON.stringify(raw),input).grades[0].relevanceScore,85)
 raw.grades[0].relevanceScore=10;assert.throws(()=>validateJudge(JSON.stringify(raw),input),/不一致/)
 delete raw.grades[0].relevanceScore;assert.throws(()=>validateJudge(JSON.stringify(raw),input),/缺少百分制/)
})

test('初评失败持久化，重试成功后回到待抽查且不生成正式评分', async t => {
  const { http, token, state, tables } = createHarness()
  const server = http.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/api/rag-tuning`
  async function request(url, body) {
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token('admin')}` }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, data: await response.json() }
  }
  const run = (await request('/retrieve', { query: '含砷废水如何处理？' })).data.run
  state.modelError = true
  const failedJudge = await request(`/runs/${run._id}/judge`, { skipExisting: true })
  assert.equal(failedJudge.status, 502)
  assert.equal(failedJudge.data.stage, 'model_request')
  assert.ok(failedJudge.data.errorId)
  let row = (await request('/review-queue')).data.rows.find(item => item._id === run._id)
  assert.equal(row.status, 'failed')
  assert.equal(row.canJudge, true)
  assert.ok(row.attemptError)
  state.modelError = false
  state.invalidJudgeOnce = true
  const beforeCorrection = state.modelCalls.length
  assert.equal((await request(`/runs/${run._id}/judge`, { skipExisting: true, autoEvidencePoints: true })).status, 200)
  assert.equal(state.modelCalls.length - beforeCorrection, 3)
  const autoRun = (await request(`/runs/${run._id}`)).data.run
  assert.equal(autoRun.testCase.evidencePointsSource, 'model')
  assert.equal(autoRun.testCase.evidencePoints.length, 2)
  assert.equal(autoRun.judge.modelCalls, 3)
  assert.equal(autoRun.judge.usage.total_tokens, 300)
  assert.equal(autoRun.judgeAttempt.error, undefined)
  const { quickMetrics } = await import('../web-admin/client/src/views/tuning/quickMetrics.mjs')
  const automatic = quickMetrics(autoRun)
  assert.equal(automatic.precisionAtK.basis, '模型估算')
  assert.equal(automatic.evidenceCoverage.value, 0.5)
  assert.equal(automatic.recallAtK.value, null)
  assert.equal(automatic.ndcgAtK.value, null)
  assert.equal(quickMetrics({ ...autoRun, metrics: { eligible: false } }).precisionAtK.value, null)
  row = (await request('/review-queue')).data.rows.find(item => item._id === run._id)
  assert.equal(row.status, 'pending')
  assert.equal(row.metrics.precisionAtK, null)
  tables.get('rag_eval_runs').get(run._id).candidates.push({ evaluationId: 'candidate-only', content: '另一条候选资料：评估砷形态与处理条件。', title: '候选池补充资料' })
  const pooled = await request(`/runs/${run._id}/judge`, { skipExisting: true, autoReferencePool: true })
  assert.equal(pooled.status, 200)
  assert.equal(pooled.data.run.judge.referencePool.complete, false)
  assert.equal(pooled.data.run.judge.referencePool.size, 2)
  assert.equal(pooled.data.run.judge.grades.length, 1)
  assert.equal(pooled.data.run.metrics.recallAtK, null)
  assert.equal(quickMetrics(pooled.data.run, 'model').recallAtK.value, 0.5)
  const beforeSkip = state.modelCalls.length
  assert.equal((await request(`/runs/${run._id}/judge`, { skipExisting: true, autoReferencePool: true })).data.skipped, true)
  assert.equal(state.modelCalls.length, beforeSkip)
})

test('真实管理路由：鉴权、用例、检索、初评、复核、对话和历史快照', async t => {
  const { http, token, state, tables } = createHarness()
  state.requiredCloudDurationMs = 20000
  const server = http.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/api/rag-tuning`
  async function request(url, method = 'GET', body, role = 'admin') {
    const result = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${token(role)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: result.status, data: await result.json() }
  }
  assert.equal((await request('/cases', 'GET', undefined, null)).status, 401)
  assert.equal((await request('/cases', 'GET', undefined, 'user')).status, 403)
  assert.equal((await request('/retrieve', 'POST', { query: '问题' }, 'viewer')).status, 403)
  assert.equal((await request('/cases', 'GET', undefined, 'viewer')).status, 200)
  assert.equal((await request('/retrieve', 'POST', { query: '问题', k: '5' })).status, 400)
  const settings = (await request('/settings')).data
  assert.equal(settings.generation.temperature, 0.3)
  const testCase = (await request('/cases', 'POST', { query: '含砷废水如何处理？', category: '跨文档问题', corpusVersion: 'fixture-v1', noAnswer: false, referencesComplete: false, references: [], evidencePoints: ['适用条件'] })).data.testCase
  assert.ok(testCase._id)
  assert.equal((await request('/retrieve', 'POST', { query: '改过的问题', caseId: testCase._id })).status, 400)
  const run = (await request('/retrieve', 'POST', { query: testCase.query, k: 5, caseId: testCase._id })).data.run
  assert.equal(state.cloudCalls[0].data.action, 'rag.test.search')
  assert.equal(state.cloudCalls[0].data.data.retrievalMode, 'knowledge')
  assert.equal(run.retrievalMode, 'knowledge')
  assert.equal(run.knowledgeBase.name, '测试知识库 fixture-default')
  delete tables.get('rag_eval_runs').get(run._id).knowledgeBase.name
  assert.equal((await request(`/runs/${run._id}`)).data.run.knowledgeBase.name, '测试知识库 fixture-default')
  assert.equal(state.cloudOptions[0].timeout, 90000)
  assert.equal(state.cloudOptions[0].retryOptions.retries, 0)
  assert.equal(run.effectiveConfig.context.maxTokens, 2000)
  assert.equal(run.metrics.precisionAtK, null)
  assert.equal(run.results.length, 1)
  const judge = await request(`/runs/${run._id}/judge`, 'POST', {})
  assert.equal(judge.status, 200)
  assert.equal(judge.data.judge.status, 'pending_review')
  assert.equal(judge.data.run._id, run._id)
  assert.equal((await request(`/runs/${run._id}/review`, 'PUT', { grades: {}, coveredPoints: [], judgeId: 'outdated' })).status, 409)
  assert.equal((await request('/review-queue')).data.rows.find(item => item._id === run._id).status, 'pending')
  const callsBeforeSkip = state.modelCalls.length
  assert.equal((await request(`/runs/${run._id}/judge`, 'POST', { skipExisting: true })).data.skipped, true)
  assert.equal(state.modelCalls.length, callsBeforeSkip)
  assert.equal((await request(`/runs/${run._id}`)).data.run.metrics.precisionAtK, null)
  assert.equal((await request(`/runs/${run._id}/review`, 'PUT', { grades: { bogus: 2 }, coveredPoints: [] })).status, 400)
  assert.equal((await request(`/runs/${run._id}/review`, 'PUT', { grades: {}, coveredPoints: [0, 0] })).status, 400)
  const review = (await request(`/runs/${run._id}/review`, 'PUT', { grades: Object.fromEntries(run.results.map(item => [item.evaluationId, 2])), coveredPoints: [0], note: '已人工检查' })).data.run
  assert.equal(review.metrics.precisionAtK, 0.2)
  assert.equal(review.metrics.evidenceCoverage, 1)
  assert.equal(review.metrics.recallAtK, null)
  assert.equal((await request('/review-queue')).data.rows.find(item => item._id === run._id).status, 'reviewed')
  const chat = await request('/chat', 'POST', { runId: run._id, query: run.query, generation: settings.generation, messages: [{ role: 'user', content: '上一轮' }, { role: 'assistant', content: '历史回答' }] })
  assert.equal(chat.status, 200)
  assert.equal(chat.data.generation.usage.total_tokens, 100)
  assert.ok(state.modelCalls.at(-1).messages.some(item => item.content.includes(run.context)))
  assert.equal((await request('/chat', 'POST', { runId: run._id, query: '另一个问题' })).status, 400)
  assert.equal((await request('/chat', 'POST', { runId: run._id, messages: [{ role: 'system', content: '绕过系统' }] })).status, 400)
  assert.equal((await request('/settings', 'PUT', { generation: { model: 'not-allowed' } })).status, 400)
  for (const query of ['失败', '降级']) {
    const failed = (await request('/retrieve', 'POST', { query })).data.run
    assert.equal(failed.metrics.precisionAtK, null)
    assert.equal(failed.metrics.empty, null)
  }
  const emptyCase = (await request('/cases', 'POST', { query: '无答案', noAnswer: true, referencesComplete: true, references: [], evidencePoints: [] })).data.testCase
  const empty = (await request('/retrieve', 'POST', { query: '无答案', caseId: emptyCase._id })).data.run
  assert.equal(empty.metrics.noAnswerCorrect, 1)
  await request('/cases', 'POST', { ...testCase, id: testCase._id, referencesComplete: true, references: run.results.map(item => ({ id: item.evaluationId, grade: 2 })) })
  assert.equal((await request(`/runs/${run._id}`)).data.run.testCase.referencesComplete, false)
  const refreshed = (await request('/retrieve', 'POST', { query: testCase.query, caseId: testCase._id })).data.run
  assert.equal(refreshed.metrics.recallAtK, 1)
  const history = (await request('/runs')).data
  assert.equal(history.summary.failed, 2)
  assert.equal(history.runs.length, 5)
  assert.equal((await request('/retrieve', 'POST', { query: testCase.query, knowledgeId: '../private' })).status, 400)
  const alternate = (await request('/retrieve', 'POST', { query: testCase.query, knowledgeId: 'kb-alternate' })).data.run
  assert.equal(alternate.knowledgeBase.id, 'kb-alternate')
  assert.equal(alternate.knowledgeBase.overridden, true)
  assert.equal(state.cloudCalls.at(-1).data.action, 'rag.tuning.search')
  assert.equal(state.cloudOptions.at(-1).timeout, 90000)
  assert.equal(state.cloudCalls.at(-1).data.data.payload.knowledgeId, 'kb-alternate')
  assert.deepEqual((await request('/runs')).data.byKnowledgeBase.map(item => item.knowledgeId).sort(), ['', 'fixture-default', 'kb-alternate'])
  assert.notEqual(alternate.results[0].evaluationId, run.results[0].evaluationId)
  await request('/cases', 'POST', { ...testCase, id: testCase._id, knowledgeId: 'fixture-default', referencesComplete: true, references: run.results.map(item => ({ id: item.evaluationId, grade: 2 })) })
  const switched = (await request('/retrieve', 'POST', { query: testCase.query, caseId: testCase._id, knowledgeId: 'kb-alternate' })).data.run
  assert.ok(switched.standardWarning)
  assert.equal(switched.metrics.recallAtK, null)
  assert.equal(switched.metrics.noAnswerCorrect, null)
  await request(`/cases/${testCase._id}`, 'DELETE')
  assert.equal((await request(`/runs/${run._id}`)).status, 200)
  const graphRun = (await request('/retrieve', 'POST', { query: '图谱测试', retrievalMode: 'graph', knowledgeId: 'ignored-kb' })).data.run
  assert.equal(graphRun.requestedKnowledgeId, '')
  assert.equal(graphRun.results.length, 1)
  assert.equal(graphRun.results[0].sourceType, 'neo4j')
  assert.equal(state.cloudCalls.at(-1).data.data.retrievalMode, 'graph')
  const hybridRun = (await request('/retrieve', 'POST', { query: '混合测试', retrievalMode: 'hybrid' })).data.run
  assert.equal(hybridRun.results.length, 2)
  assert.equal((await request('/retrieve', 'POST', { query: '无效', retrievalMode: 'other' })).status, 400)
  // Reclassify a stored legacy degradation without rerunning retrieval or migrating data.
  const old = tables.get('rag_eval_runs').get(run._id)
  old.degraded = true
  old.sourceInfo = { degraded: true, zhipu: { success: true, partialFailure: false, degraded: true,
    queryVariants: ['原问题', '双语扩展'], retrievalFallbacks: [{ reason: 'rerank_cooldown' }, { reason: 'rerank_cooldown' }] },
    neo4j: { success: false, skipped: true, reason: 'disabled' } }
  const recovered = (await request(`/runs/${run._id}`)).data.run
  assert.equal(recovered.metrics.eligible, true)
  assert.equal(recovered.metrics.precisionAtK, 0.2)
  assert.equal(recovered.metrics.rerankMode, 'fallback_off')
  assert.equal((await request(`/runs/${run._id}/judge`, 'POST', {})).status, 200)
  const grouped = (await request('/runs')).data.byKnowledgeBase
  assert.ok(grouped.some(item => item.knowledgeId === 'fixture-default' && item.rerankMode === 'fallback_off'))
  assert.ok(grouped.some(item => item.knowledgeId === 'fixture-default' && item.rerankMode === 'unknown'))
  old.sourceInfo.zhipu.partialFailure = true
  assert.equal((await request(`/runs/${run._id}/judge`, 'POST', {})).status, 400)
  assert.equal((await request(`/runs/${run._id}`)).data.run.metrics.precisionAtK, null)
  state.requiredCloudDurationMs = 95000
  const timedOut = (await request('/retrieve', 'POST', { query: '模拟超过调用预算' })).data.run
  assert.match(timedOut.error, /后台调用云函数超时/)
  assert.equal(timedOut.errorDetail.stage, 'cloudbase_transport')
  assert.equal(timedOut.errorDetail.code, 'ESOCKETTIMEDOUT')
  assert.equal(timedOut.errorDetail.message, 'request timeout')
  assert.equal(timedOut.metrics.precisionAtK, null)
})
