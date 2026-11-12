import { workbookBytes } from './answerExport.mjs'
export const minimumCoverage = 0.8
export function batchRuns(batch) {
  if (!batch) return []
  return batch.ids.map((id,i) => ({...batch.settings, _id:id, query:batch.queries[i], knowledgeId:batch.knowledgeIds?.[i] ?? batch.settings.knowledgeId, scoringVersion:batch.settings.scoringVersion || (batch.settings.evaluationMode ? 'factual-prf-v2' : 'analytic-100-v2'), pendingRecord:!batch.summaries?.[i], ...(batch.summaries?.[i] || {})}))
}
export const mode = 'factual-prf-v1'
export const groups = { A: 'A 直接回答', B: 'B 文档 RAG', C: 'C 文档＋图谱', D: 'D 文档＋专家规范', E: 'E 文档＋图谱＋专家规范' }
export const metrics = { accuracy: 'Accuracy · 严格整题达标率', precision: 'Precision · 可判定事实支持率', recall: 'Recall · 要点覆盖率', f1: 'F1 · 调和均值' }
export const format = value => Number.isFinite(value) ? (value * 100).toFixed(1) : '—'
export function metricValue(run, key, metric) {
  const v = run.variants?.[key]
  if (run.evaluationMode !== mode || !v?.judge || v.finishReason === 'length') return null
  const n = v.judge.metrics?.[metric]?.value
  return Number.isFinite(n) ? n : null
}
export function usage(calls) {
  return { known: calls.reduce((n,c) => n + (Number.isFinite(c.usage?.total_tokens) ? c.usage.total_tokens : 0), 0), missing: calls.filter(c => !Number.isFinite(c.usage?.total_tokens)).length }
}
export function summarize(runs, paired = true) {
  const baseKey = r => JSON.stringify([r.knowledgeId || '',r.generation?.model,r.judgeModel,r.k,r.evidenceProtocol || 'legacy'])
  const configs = new Map()
  for (const r of runs.filter(r => r.evaluationMode === mode)) {
    const key = JSON.stringify([r.knowledgeId || '', r.generation?.model, r.judgeModel, r.k, r.scoringVersion, r.evidenceProtocol || 'legacy'])
    if (!configs.has(key)) configs.set(key, { key, label: `${r.knowledgeBase?.name || r.knowledgeId || '默认知识库'} · ${r.generation?.model || ''} / ${r.judgeModel || ''} · K=${r.k ?? 5} · ${r.scoringVersion || mode} · ${r.evidenceProtocol || 'legacy'}`, runs: [] })
    configs.get(key).runs.push(r)
  }
  return [...configs.values()].map(config => ({ ...config, comparisons:Object.keys(groups).filter(g=>g!=='B').map(g=>{const differences=config.runs.filter(r=>metricValue(r,'B','f1')!==null&&metricValue(r,g,'f1')!==null).map(r=>metricValue(r,g,'f1')-metricValue(r,'B','f1'));return {label:groups[g],n:differences.length,delta:differences.length?differences.reduce((a,b)=>a+b,0)/differences.length:null,win:differences.filter(d=>d>1e-8).length,tie:differences.filter(d=>Math.abs(d)<=1e-8).length,loss:differences.filter(d=>d< -1e-8).length}}), rows: Object.entries(groups).map(([key,label]) => {
    const cells = Object.fromEntries(Object.keys(metrics).map(m => {
      const values = config.runs.filter(r => !paired || Object.keys(groups).every(g => metricValue(r,g,m) !== null)).map(r => metricValue(r,key,m)).filter(v => v !== null)
      const total = runs.filter(r => r.evaluationMode === mode && baseKey(r) === baseKey(config.runs[0])).length
      const required = Math.ceil(total * minimumCoverage), accepted = total > 0 && values.length >= required
      return [m, { value: values.length ? values.reduce((a,b) => a+b,0)/values.length : null, n: values.length, full:values.filter(v=>v===1).length, total, required, coverage: total ? values.length/total : 0, accepted, missing:Math.max(0,required-values.length) }]
    }))
    const times = config.runs.map(r => r.variants?.[key]?.timings?.totalMs).filter(Number.isFinite)
    return { key, label, ...cells, time: times.length ? Math.round(times.reduce((a,b) => a+b,0)/times.length) : null, ...usage(config.runs.flatMap(r => (r.calls || []).filter(c => c.stage === `generate:${key}`))) }
  }), shared: usage(config.runs.flatMap(r => (r.calls || []).filter(c => !c.stage.startsWith('generate:')))) }))
}
export function exportWorkbook(runs, paired) {
  const sheets = [
    { name: '汇总', rows: [['知识库及配置','组别',...Object.keys(metrics).flatMap(k => [metrics[k]+'（0–100）','有效题数','计划题数','有效率（%）','至少需有效题数','验收状态']),'检索生成均耗时ms','已知Token','缺失usage调用数']] },
    { name: '逐题评分', rows: [['ID','知识库','问题','组别',...Object.keys(metrics),'正确事实数','Precision分母（v2可判定事实数）','覆盖要点数','必要要点数','状态','错误','检索生成ms','事实可核验率（0–100）','未知事实数']] },
    { name: '回答与标准', rows: [['ID','问题','组别','完整回答','共同标准JSON','评审依据JSON']] },
    { name: '完整记录', rows: [['ID','JSON分段序号','JSON片段（按顺序拼接）']] },
    { name: '说明', rows: [['项目','说明'], ['有效题数门槛','所有四项指标均须有效题数/计划题数≥80%，不足80%仍显示有效题目的实际均值，但标记样本不足，仅供参考；无有效评分才留空。计划题数含未开始、失败、无法评估及截断。共同样本模式按五组共同有效数验收；不同评分版本独立验收。'], ['v3原子标准','复合元素、数值或步骤拆分；明确acceptance；complete/partial/absent/contradicted/unknown判定，部分覆盖列明缺失项。分数不按组别或排名调整。'], ['类型','LLM自动标准与盲评，模型估计，不等同人工金标准'], ['Accuracy','明确存在失败项记0；无失败但有未知则留空；全部达标为1。事实全正确、必要要点全覆盖、工况全部满足。不是含TN的分类准确率。'], ['Precision','v2：正确且证据支持的事实数/可判定事实数；unknown不判错，须结合可核验率。v1存在unknown时为空。无事实回答记0。'], ['Recall','v2完整覆盖1、部分覆盖0.5、未覆盖0，求和除以要点数；v1仅0或1。无法判断为空。'], ['F1','逐题2PR/(P+R)，再等权平均；两者均0时为0。'], ['单位','汇总及逐题指标均乘100显示；事实/要点计数保留整数。'], ['汇总口径',paired ? '每项指标仅取ABCDE五组均有效的共同题目；按知识库与模型、K分组' : '每组每项指标按有效题目等权平均，样本可能不同'], ['缺失','失败、证据不足、回答截断不作为零分；保留原始记录。'], ['Token','生成按组计；标准与集中评审单列共享，禁止重复分摊。仅统计上游返回usage，图谱内部用量可能缺失。']] }
  ]
  const diagnostics={name:'区分度与配对',rows:[['知识库及配置','组别','类型','指标','有效题数','满分题数','F1差值（分）','提升','持平','下降']]}
  sheets.push(diagnostics)
  for (const config of summarize(runs,paired)) {
    for(const row of config.rows) for(const m of Object.keys(metrics)) diagnostics.rows.push([config.label,row.label,'满分统计',m,row[m].n,row[m].full])
    for(const row of config.comparisons) diagnostics.rows.push([config.label,row.label,'相对B的配对比较','F1',row.n,null,row.delta===null?null:row.delta*100,row.win,row.tie,row.loss])
    for (const row of config.rows) sheets[0].rows.push([config.label,row.label,...Object.keys(metrics).flatMap(m => [row[m].value === null ? null : row[m].value*100,row[m].n,row[m].total,row[m].coverage*100,row[m].required,row[m].accepted?'达标':'样本不足']),row.time,row.known,row.missing])
    sheets[0].rows.push([config.label,'共享标准及评审',...Array(25).fill(null),config.shared.known,config.shared.missing])
  }
  for (const r of runs) {
    for (const [g,label] of Object.entries(groups)) {
      const v = r.variants?.[g], j = v?.judge
      sheets[1].rows.push([r._id,r.knowledgeBase?.name || r.knowledgeId,r.query,label,...Object.keys(metrics).map(m => { const n = metricValue(r,g,m); return n === null ? null : n*100 }),j?.metrics?.precision?.numerator,j?.metrics?.precision?.denominator,j?.metrics?.recall?.numerator,j?.metrics?.recall?.denominator,j?.status,v?.error || r.lastError,v?.timings?.totalMs,Number.isFinite(j?.verificationCoverage) ? j.verificationCoverage*100 : null,j?.unknownClaims])
      sheets[2].rows.push([r._id,r.query,label,v?.answer,JSON.stringify(r.rubric),JSON.stringify(j)])
    }
    const raw = JSON.stringify(r)
    let index=1
    for (let i=0; i<raw.length;) {
      let end=Math.min(i+28000,raw.length)
      if (end<raw.length && /[\uD800-\uDBFF]/.test(raw[end-1])) end--
      sheets[3].rows.push([r._id,index++,raw.slice(i,end)]);i=end
    }
  }
  return workbookBytes(sheets)
}
