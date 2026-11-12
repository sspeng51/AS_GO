const { test } = require('node:test')
const assert = require('node:assert/strict')
const { evaluate, validateRubric, VERSION } = require('../web-admin/server/utils/factualEvaluation')
const sources=[{id:'D1',content:'应检查形态。'}],rubric={points:[{text:'检查形态',sourceIds:['D1']},{text:'检查pH',sourceIds:['D1']}],conditions:[]},answer='应检查形态。温度为100度。'
const input=()=>({extractionComplete:true,claims:[{statement:'检查形态',quoteId:'A1',verdict:'correct',sourceIds:['D1'],reason:'有依据'},{statement:'100度',quoteId:'A2',verdict:'unsupported',sourceIds:[],reason:'无依据'}],coverage:[{point:0,covered:true,quoteId:'A1',reason:'覆盖'},{point:1,covered:false,reason:'遗漏'}],conditions:[]})
test('四指标按事实与要点计算；未知不补零，重复及伪造证据拒绝',()=>{
 const j=evaluate(input(),answer,rubric,sources)
 assert.deepEqual(Object.fromEntries(Object.entries(j.metrics).map(([k,m])=>[k,m.value])),{accuracy:0,precision:.5,recall:.5,f1:.5})
 const unknown=input();unknown.claims[1].verdict='unknown'
 assert.equal(evaluate(unknown,answer,rubric,sources).metrics.precision.value,null)
 assert.equal(evaluate(unknown,answer,rubric,sources).metrics.accuracy.value,null)
 const fake=input();fake.claims[0].sourceIds=['D99'];assert.throws(()=>evaluate(fake,answer,rubric,sources))
 const dup=input();dup.claims.push(dup.claims[0]);assert.throws(()=>evaluate(dup,answer,rubric,sources))
 const missing=input();missing.coverage.pop();assert.throws(()=>evaluate(missing,answer,rubric,sources))
 const empty={extractionComplete:true,claims:[],coverage:[0,1].map(point=>({point,covered:false,reason:'无回答'})),conditions:[]}
 assert.equal(evaluate(empty,answer,rubric,sources).metrics.f1.value,0)
 assert.throws(()=>validateRubric({points:[],conditions:[]},sources))
 assert.equal(validateRubric({points:[],conditions:[],insufficientReason:'证据不足'},sources).points.length,0)
})
test('宏平均逐题F1，按配置隔离，共同样本与Excel输出',async()=>{
 const {summarize,exportWorkbook}=await import('../web-admin/client/src/views/tuning/factualMetrics.mjs')
 const make=(id,p,r)=>({_id:id,evaluationMode:VERSION,knowledgeId:'k1',generation:{model:'glm-5.3'},judgeModel:'glm-4.7',k:5,variants:Object.fromEntries(['A','B','C','D','E'].map(g=>[g,{judge:{metrics:{accuracy:{value:0},precision:{value:p},recall:{value:r},f1:{value:2*p*r/(p+r)}}}}])),calls:[]})
 const a=make('1',1,.5),b=make('2',.5,1)
 const report=summarize([a,b]);assert.equal(report[0].rows[0].f1.value,2/3);assert.equal(report[0].rows[0].f1.n,2)
 b.variants.E.judge.metrics.recall.value=null
 assert.equal(summarize([a,b])[0].rows[0].recall.n,1)
 assert.equal(summarize([a,b],false)[0].rows[0].recall.n,2)
 b.knowledgeId='k2';assert.equal(summarize([a,b]).length,2)
 a.variants.A.finishReason='length';assert.equal(summarize([a])[0].rows[0].f1.n,0)
 const bytes=exportWorkbook([a,b],true);assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b)
})
test('HTTP五组隔离生成，共同标准，部分成功保留，重试仅补缺失，旧实验隔离',async t=>{
 const {createHarness}=require('./fixtures/rag-tuning-harness'),{http,token,state,tables}=createHarness()
 const server=http.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close())
 const base=`http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests`
 async function req(path,body){const res=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token('admin')}`},body:body?JSON.stringify(body):undefined});return {status:res.status,...await res.json()}}
 const created=await req('',{query:'含砷废水如何处理？',evaluationMode:VERSION});assert.equal(created.status,200)
 const id=created.experiment._id
 for(const phase of ['prepare','generate','rubric']) assert.equal((await req(`/${id}/${phase}`,{})).status,200)
 assert.equal(state.modelCalls.length,6)
 const generation=state.modelCalls.slice(0,5)
 assert.equal(generation.filter(c=>!c.messages[1].content.includes('参考资料')).length,1)
 const standardInput=JSON.parse(state.modelCalls[5].messages[1].content);assert.ok(standardInput.evidence.length);assert.equal(standardInput.answers,undefined)
 state.factualMissingOnce=true
 assert.equal((await req(`/${id}/judge`,{})).status,200)
 let run=(await req(`/${id}`)).experiment;assert.equal(Object.values(run.variants).filter(v=>v.judge).length,5)
 assert.equal((await req(`/${id}/judge`,{})).status,200)
 assert.equal(JSON.parse(state.modelCalls.at(-1).messages[1].content).answers.length,1)
 assert.equal((await req(`/${id}/judge`,{})).status,200);assert.equal(state.modelCalls.length,8)
 run=(await req(`/${id}`)).experiment;assert.equal(run.scoringVersion,'factual-prf-v3');assert.equal(run.variants.A.judge.metrics.accuracy.value,1)
 assert.equal((await req('')).experiments.length,0)
 assert.equal((await req(`?evaluationMode=${VERSION}`)).experiments.length,1)
 const stored=tables.get('rag_answer_experiments').get(id)
 stored.scoringVersion=VERSION
 const generationCount=state.modelCalls.length
 assert.equal((await req(`/${id}/rubric`,{})).status,200)
 assert.equal((await req(`/${id}/judge`,{})).status,200)
 const upgraded=(await req(`/${id}`)).experiment
 assert.equal(state.modelCalls.length,generationCount+2)
 assert.ok(upgraded.variants.A.judgeHistory.length)
 assert.equal(upgraded.variants.A.answer,run.variants.A.answer)
 assert.ok(upgraded.rubricHistory.length)
 delete tables.get('rag_answer_experiments').get(id).variants.E.judge
 const callsBeforeRepair=state.modelCalls.length
 const repaired=await req(`/${id}/repair`,{})
 assert.equal(repaired.status,200)
 assert.equal(repaired.experiment.variants.E.judge.recoveredLocally,true)
 assert.equal(state.modelCalls.length,callsBeforeRepair)
 state.factualRubricEmptyOnce=true
 const empty=await req('',{query:'缺少工况的测试问题',evaluationMode:VERSION})
 const emptyId=empty.experiment._id
 for(const phase of ['prepare','generate','rubric','judge']) assert.equal((await req(`/${emptyId}/${phase}`,{})).status,200)
 const supplemented=(await req(`/${emptyId}`)).experiment
 assert.equal(supplemented.factualFollowup.status,'complete')
 assert.ok(supplemented.judgeSupplement.length)
 assert.equal(supplemented.calls.filter(c=>c.stage.startsWith('generate:')).length,5)
 assert.equal(supplemented.variants.A.sources.length,0)
 assert.equal(supplemented.variants.E.judge.metrics.accuracy.value,1)
 const interrupted=tables.get('rag_answer_experiments').get(emptyId)
 interrupted.variants.A.judge.metrics.accuracy.value=null
 interrupted.factualFollowup={revision:2,status:'failed',startedAt:new Date().toISOString(),attempts:1,queries:['cached query'],pools:[[]],evidenceApplied:true}
 const resumeCalls=state.modelCalls.length
 assert.equal((await req(`/${emptyId}/judge`,{})).status,200)
 const resumed=(await req(`/${emptyId}`)).experiment
 assert.equal(resumed.factualFollowup.attempts,2)
 assert.equal(resumed.factualFollowup.status,'evidence_gap')
 assert.equal(state.modelCalls.length,resumeCalls)
 assert.equal(resumed.factualFollowup.pools,undefined)
 assert.equal((await req(`/${emptyId}/judge`,{})).status,200)
 assert.equal(state.modelCalls.length,resumeCalls)
 tables.get('rag_answer_experiments').get(emptyId).factualFollowup={revision:2,status:'failed',startedAt:new Date().toISOString(),attempts:3}
 assert.notEqual((await req(`/${emptyId}/judge`,{})).status,200)
 assert.equal(state.modelCalls.length,resumeCalls)
 const before=state.modelCalls.length
 state.factualMissingOnce=true
 const submitted=await req('/batches',{queries:['含砷废水如何处理？','含砷水如何验证？'],evaluationMode:VERSION})
 assert.equal(submitted.status,202)
 const batchId=submitted.batch._id
 async function finished(){for(let i=0;i<300;i++){const job=(await req(`/batches/${batchId}`)).batch;if(!['queued','running'].includes(job.status))return job;await new Promise(r=>setTimeout(r,10))}throw new Error('批次未结束')}
 let job=await finished();assert.equal(job.status,'completed');assert.equal(job.settings.evaluationMode,VERSION)
 assert.equal(state.modelCalls.length-before,15)
 assert.equal((await req(`/batches/${batchId}/resume`,{})).status,200)
 job=await finished();assert.equal(job.status,'completed');assert.equal(state.modelCalls.length-before,15)
 assert.ok(Object.values(job.summaries).every(s=>s.evaluationMode===VERSION && s.variants.E.judge.metrics.f1.value===1))
 assert.equal((await req('/batches')).batches.length,0)
 assert.equal((await req(`/batches?evaluationMode=${VERSION}`)).batches.length,1)
})

 test('v2未知事实不判错、半覆盖计分且不伪造严格满分',()=>{
 const v=input();v.claims[1].verdict='unknown';v.coverage[1]={point:1,covered:0.5,quoteId:'A2',reason:'部分覆盖'}
 const j=evaluate(v,answer,rubric,sources,'factual-prf-v2')
 assert.equal(j.metrics.precision.value,1);assert.equal(j.metrics.recall.value,.75)
 assert.equal(j.metrics.accuracy.value,0);assert.equal(j.verificationCoverage,.5)
 assert.equal(j.metrics.f1.value,1.5/1.75)
 })

test('空来源兼容，不制造证据或忽略非法来源',()=>{
 const v=input();v.claims[1].sourceIds=null;v.claims[1].verdict='unknown'
 const j=evaluate(v,answer,rubric,sources,'factual-prf-v2')
 assert.equal(j.metrics.accuracy.value,0);assert.equal(j.metrics.precision.value,1)
 const x=input();x.claims[0].sourceIds=[]
 assert.equal(evaluate(x,answer,rubric,sources,'factual-prf-v2').claims[0].verdict,'unknown')
 x.claims[0].sourceIds=['D999'];assert.throws(()=>evaluate(x,answer,rubric,sources,'factual-prf-v2'))
 assert.equal(v.claims[1].sourceIds,null)
})

test('80%验收包含未开始题，零分是有效分，边界及共同样本正确',async()=>{
 const {summarize,batchRuns}=await import('../web-admin/client/src/views/tuning/factualMetrics.mjs')
 const job={settings:{evaluationMode:VERSION,generation:{model:'glm-5.3'},judgeModel:'glm-4.7',k:5},ids:Array.from({length:20},(_,i)=>String(i)),queries:Array(20).fill('问题'),summaries:{}}
 for(let i=0;i<16;i++)job.summaries[i]={variants:Object.fromEntries(['A','B','C','D','E'].map(g=>[g,{judge:{metrics:Object.fromEntries(['accuracy','precision','recall','f1'].map(m=>[m,{value:0}]))}}]))}
 let rows=summarize(batchRuns(job),false)[0].rows
 assert.equal(rows[0].accuracy.value,0);assert.equal(rows[0].accuracy.accepted,true);assert.equal(rows[0].accuracy.total,20)
 job.summaries[15].variants.A.judge.metrics.accuracy.value=null
 rows=summarize(batchRuns(job),false)[0].rows
 assert.equal(rows[0].accuracy.accepted,false);assert.equal(rows[0].accuracy.value,0);assert.equal(rows[0].accuracy.missing,1)
 assert.equal(rows[1].accuracy.accepted,true)
 rows=summarize(batchRuns(job),true)[0].rows
 assert.equal(rows[1].accuracy.accepted,false)
 assert.equal(rows[0].precision.accepted,true)
})

test('不足80%仍返回实际均值，没有有效评分才留空',async()=>{
 const {summarize,batchRuns,exportWorkbook}=await import('../web-admin/client/src/views/tuning/factualMetrics.mjs')
 const batch={settings:{evaluationMode:VERSION},ids:['1','2','3'],queries:['a','b','c'],summaries:{0:{variants:{A:{judge:{metrics:{precision:{value:.75}}}}}}}}
 const runs=batchRuns(batch),row=summarize(runs,false)[0].rows[0]
 assert.equal(row.precision.accepted,false);assert.equal(row.precision.value,.75)
 assert.equal(row.precision.n,1);assert.equal(row.precision.total,3)
 assert.equal(row.accuracy.value,null)
 const xml=new TextDecoder().decode(exportWorkbook(runs,false))
 assert.ok(xml.includes('<v>75</v>'));assert.ok(xml.includes('样本不足'))
})

test('双检索池交错选取，保留第二条证据，去重并记录截断',()=>{
 const {selectSupplement}=require('../web-admin/server/utils/factualSupplement')
 const pools=[Array.from({length:20},(_,i)=>({content:'first'+i})),Array.from({length:20},(_,i)=>({content:'second'+i}))]
 const selected=selectSupplement(pools)
 assert.equal(selected.length,12);assert.equal(selected.filter(s=>s.queryIndex===1).length,6)
 assert.equal(selectSupplement([[{content:'same'}],[{content:'same'}]]).length,1)
 const long=selectSupplement([[{content:'a'.repeat(13000)}]])[0]
 assert.equal(long.content.length,12000);assert.equal(long.truncated,true)
})
test('边界说明需原文与标注双重匹配，技术推测不可排除',()=>{
 const a='The provided evidence does not report particle size. 应检查形态。'
 const v={extractionComplete:true,claims:[{statement:'提供的资料没有粒径数据',quoteId:'A1',verdict:'unknown',sourceIds:[],reason:'未报告'},{statement:'应检查形态',quoteId:'A1',verdict:'correct',sourceIds:['D1'],reason:'原文'}],coverage:[{point:0,covered:true,quoteId:'A1',reason:'覆盖'}],conditions:[]}
 const j=evaluate(v,a,{points:[rubric.points[0]],conditions:[]},sources,'factual-prf-v2')
 assert.equal(j.excludedClaims.length,1);assert.equal(j.metrics.accuracy.value,1)
 v.claims[0].statement='高过饱和度导致细粒沉淀'
 assert.equal(evaluate(v,a,{points:[rubric.points[0]],conditions:[]},sources,'factual-prf-v2').excludedClaims.length,0)
})

test('按问题选取文档后部证据，小预算不清空内容，图谱去重且预算有限',()=>{
 const f=require('../web-admin/server/utils/focusedEvidence')
 const text='Background unrelated. '.repeat(200)+'Kaldo zinc recovery temperature 90 C duration 120 min. '.repeat(20)
 const x=f.excerpt(text,'Kaldo zinc recovery temperature',1800)
 assert.ok(x.content.includes('Kaldo'));assert.ok(x.content.length<=1800)
 assert.ok(f.excerpt(text,'Kaldo',900).content.length>0)
 const graph=[{id:'G1',content:'calcium wastewater adsorption'},{id:'G2',content:'antimony slag carbothermal reduction'},{id:'G3',content:'antimony slag carbothermal reduction'}]
 const selected=f.selectGraph(graph,'How were carbothermal reduction parameters optimized for antimony slag?')
 assert.deepEqual(selected.sources.map(s=>s.id),['G2'])
 assert.ok(selected.diagnostics.dropped.some(s=>s.reason==='duplicate'))
 assert.match(f.instruction,/图谱关系是待核验/)
})

test('通用混合检索保护各文档预算与原图谱编号，通用回答带覆盖约束',()=>{
 const {buildContext}=require('../cloudfunctions/processKnowledge/lib/hybridEvidence')
 const cfg={context:{maxTokens:800},graph:{contextMaxTokens:800}}
 const context=buildContext([{title:'first',content:'background '.repeat(1000)},{title:'second',content:'scorodite target pH 0.6'}],[{content:'unrelated gypsum'},{content:'scorodite precipitation'}],cfg,'scorodite pH')
 assert.ok(context.includes('[文档2]'));assert.ok(context.includes('pH 0.6'))
 assert.ok(context.includes('[图谱2]'));assert.ok(!context.includes('[图谱1]'))
 const source=require('../cloudfunctions/processKnowledge/lib/expertPolicy')
 const server=require('../web-admin/server/utils/expertPolicy')
 const messages=[{role:'user',content:'What pH favors scorodite precipitation?'}]
 assert.deepEqual(source.applyExpertPolicy(messages),server.applyExpertPolicy(messages))
 assert.ok(source.applyExpertPolicy(messages).messages[0].content.includes('逐项检查'))
 assert.equal(messages.length,1)
})

test('v3依据离散判定计算覆盖，矛盾不拿半分，拒绝无依据部分覆盖',()=>{
 const v=input();v.coverage[0]={point:0,covered:true,decision:'contradicted',missing:[],reason:'数值错误'};v.coverage[1]={point:1,decision:'partial',missing:['缺少必要工况'],quoteId:'A2',reason:'仅部分覆盖'}
 const j=evaluate(v,answer,rubric,sources,'factual-prf-v3')
 assert.equal(j.metrics.recall.value,.25)
 v.coverage[1].missing=[]
 assert.throws(()=>evaluate(v,answer,rubric,sources,'factual-prf-v3'))
 assert.throws(()=>validateRubric(rubric,sources,'factual-prf-v3'))
 assert.equal(validateRubric({...rubric,points:rubric.points.map(p=>({...p,acceptance:'明确指出该项要求'}))},sources,'factual-prf-v3').points.length,2)
})
