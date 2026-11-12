const {test}=require('node:test'),assert=require('node:assert/strict')
const {recoverAnswerJudge}=require('../web-admin/server/utils/answerJudgeRecovery')
const answer='需要核验工况并说明机制[D1]。',rubric={points:['解释机制和边界'],conditions:['匹配条件']},sources=[{id:'D1',content:'需要核验工况并说明机制。'}]
function input(){return {claims:[{statement:'核验工况',quote:answer,breakdown:{core:55,depth:18,boundary:10},supportScore:82,citationScore:76,citedIds:['D1'],sourceQuotes:[{id:'D1',quote:sources[0].content}],reason:'缺少具体温度边界'}],conditions:[{point:0,quote:answer,breakdown:{core:30,depth:20,boundary:15},reason:'未说明验证方法'}],coverage:[{point:0,quote:answer,breakdown:{core:32,depth:24,boundary:16},reason:'仅部分解释机制'}]}}
test('百分制分项求和，部分证据支持可区分76和82，不退化成满分',async()=>{
 const result=recoverAnswerJudge(input(),answer,rubric,sources,'analytic-100-v2')
 assert.deepEqual(Object.fromEntries(['professionalCorrectness','conditionApplicability','answerCoverage','citationSupport','supportedConclusions'].map(k=>[k,result.metrics[k].value])),{professionalCorrectness:.83,conditionApplicability:.65,answerCoverage:.72,citationSupport:.76,supportedConclusions:.82})
 const {metricFormat}=await import('../web-admin/client/src/views/tuning/answerMetrics.mjs')
 assert.equal(metricFormat(.83,'professionalCorrectness','analytic-100-v2'),'83.0 / 100分')
 const {buildAnswerSheets}=await import('../web-admin/client/src/views/tuning/answerExport.mjs')
 const sheets=buildAnswerSheets([{scoringVersion:'analytic-100-v2',variants:{A:{answer,judge:result}},calls:[]}])
 assert.equal(sheets[0].rows[1][4].value,83)
 assert.equal(sheets[1].rows[1][9],'分（0–100）')
})
test('缺分项、越界、无原文支持不能获得新标准高分',()=>{
 const a=input();a.claims[0].breakdown.core=61
 assert.equal(recoverAnswerJudge(a,answer,rubric,sources,'analytic-100-v2').metrics.professionalCorrectness.value,null)
 const b=input();delete b.claims[0].sourceQuotes
 assert.equal(recoverAnswerJudge(b,answer,rubric,sources,'analytic-100-v2').metrics.citationSupport.value,null)
 const c=input();c.claims[0].supportScore=null
 assert.equal(recoverAnswerJudge(c,answer,rubric,sources,'analytic-100-v2').metrics.supportedConclusions.value,null)
 const d=input();delete d.coverage[0].breakdown;d.coverage[0].score=100
 assert.equal(recoverAnswerJudge(d,answer,rubric,sources,'analytic-100-v2').metrics.answerCoverage.value,null)
})

test('独立引用清单覆盖全部引用，缺项和虚构依据不可计分',()=>{
 const a=input();a.claims[0].citedIds=[];a.claims[0].citationScore=null
 a.citationReviews=[{id:'D1',quoteId:'A1',sourceQuoteId:'D1:1',score:72,reason:'部分支持'}]
 let r=recoverAnswerJudge(a,answer,rubric,sources,'analytic-100-v2')
 assert.equal(r.metrics.citationSupport.value,.72);assert.equal(r.status,'model_estimate')
 a.citationReviews[0].sourceQuoteId='D1:999'
 r=recoverAnswerJudge(a,answer,rubric,sources,'analytic-100-v2')
 assert.equal(r.metrics.citationSupport.value,null);assert.equal(r.status,'partial')
 a.citationReviews=[]
 assert.equal(recoverAnswerJudge(a,answer,rubric,sources,'analytic-100-v2').metrics.citationSupport.value,null)
})
