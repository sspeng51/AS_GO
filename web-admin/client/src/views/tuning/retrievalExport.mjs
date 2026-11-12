import {workbookBytes} from './answerExport.mjs'
import {quickMetrics,runState} from './quickMetrics.mjs'
export function retrievalSheets(rows,report,names,basis,paired) {
  const keys=Object.keys(names), cell=(v,key)=>({value:Number.isFinite(v)?v*100:null,style:2})
  const sheets=[
    {name:'知识库汇总',rows:[['知识库与配置','题数','检索失败','初评失败','检索均耗时ms',...keys.flatMap(k=>[names[k],'有效题数'])]]},
    {name:'逐题指标',rows:[['记录ID','知识库','问题','K','状态','评分版本','指标','数值','单位','评分依据','检索耗时ms','初评耗时ms','Token总量']]},
    {name:'逐条证据评分',rows:[['记录ID','问题','资料ID','排名','标题','完整内容','相关等级','相关性分数','理由','原文依据','直接支持/50','工况范围/30','细节/20']]},
    {name:'标准与诊断',rows:[['记录ID','问题','证据点','候选池标准','人工复核','错误','来源诊断']]},
    {name:'原始记录',rows:[['记录ID','分段序号','完整JSON（按序拼接）']]},
    {name:'说明',rows:[['统计口径',basis==='model'?'模型估算':'人工确认'],['共同样本',paired?'各指标共同有效题目':'各组有效题目'],['上下文相关性','新标准0–100分；旧标准由0/1/2等级换算。评分版本分组。'],['排名指标','全部展示为原始值×100分，原始记录保留0–1。Precision分母为K；证据效用为细评分总和÷K。'],['候选池','模型Recall/NDCG仅为本次候选资料池估算，不是全库召回。'],['缺失值','未知留空；不补零。已保存的结果和未开始任务均导出。']]}
  ]
  for(const g of report)sheets[0].rows.push([g.label,g.count,g.failures,g.judgeFailures,g.latency,...keys.flatMap(k=>[cell(g.metrics[k].value,k),g.metrics[k].samples])])
  for(const r of rows){
    const metrics=quickMetrics(r,basis)
    for(const k of keys)sheets[1].rows.push([r._id||r.requestId,r.knowledgeBase?.name||r.targetId||'默认知识库',r.query,r.k,runState(r).label,r.judge?.version,names[k],cell(metrics[k].value,k),'分（0–100）',metrics[k].basis,r.latencyMs,r.judge?.latencyMs,r.judge?.usage?.total_tokens])
    for(const [i,s] of (r.results||[]).entries()){const g=r.judge?.grades?.find(g=>g.id===s.evaluationId);sheets[2].rows.push([r._id,r.query,s.evaluationId,i+1,s.title,s.content,g?.grade,g?.relevanceScore,g?.reason,g?.quote,g?.breakdown?.directness,g?.breakdown?.scope,g?.breakdown?.detail])}
    sheets[3].rows.push([r._id,r.query,JSON.stringify(r.testCase?.evidencePoints),JSON.stringify(r.judge?.referencePool),JSON.stringify(r.review),r.error||r.autoError||r.judgeAttempt?.error,JSON.stringify(r.sourceInfo)])
    const raw=JSON.stringify(r);let n=0
    for(let p=0;p<raw.length;){let end=Math.min(p+30000,raw.length);if(end<raw.length&&/[\uD800-\uDBFF]/.test(raw[end-1]))end--;sheets[4].rows.push([r._id||r.requestId,++n,raw.slice(p,end)]);p=end}
  }
  return sheets
}
export const exportRetrievalWorkbook=(...args)=>workbookBytes(retrievalSheets(...args))
