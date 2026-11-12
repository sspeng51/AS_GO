const {test}=require('node:test'),assert=require('node:assert/strict')
const prompt=require('../web-admin/server/utils/answerJudgePrompt')
const {recoverAnswerJudge}=require('../web-admin/server/utils/answerJudgeRecovery')
test('生产评审示例只有百分制字段，不能再按旧布尔模板输出',()=>{
 const line=prompt.split('\n').find(line=>line.startsWith('{"reviews"'))
 const result=JSON.parse(line).reviews[0].result
 for(const key of ['claims','conditions','coverage'])assert.ok(result[key].every(item=>item.breakdown))
 assert.equal(typeof result.claims[0].supportScore,'number')
 assert.equal(typeof result.claims[0].citationScore,'number')
 assert.equal(result.claims[0].correct,undefined)
 assert.equal(result.conditions[0].applicable,undefined)
 assert.equal(result.coverage[0].covered,undefined)
})
test('真实故障形状：只有旧布尔值与顶层分数，不能凭空还原分项',()=>{
 const result=recoverAnswerJudge({claims:[{statement:'结论',quote:'结论',correct:true,supported:true,citedIds:[],reason:'理由'}],conditions:[{point:0,applicable:true,quote:'结论',reason:'理由'}],coverage:[{point:0,covered:true,quote:'结论',reason:'理由'}],supportScore:80,citationScore:85},'结论',{conditions:['条件'],points:['要求']},[],'analytic-100-v2')
 assert.equal(result.status,'partial')
 assert.equal(result.metrics.professionalCorrectness.value,null)
 assert.equal(result.metrics.supportedConclusions.value,null)
})
