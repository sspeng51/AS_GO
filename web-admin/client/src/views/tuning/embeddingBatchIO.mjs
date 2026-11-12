import { csvRows, xlsxRows } from './evidenceAutoIO.mjs'
import { workbookBytes } from './answerExport.mjs'
export function validateCases(cases) {
 if(!Array.isArray(cases)||!cases.length)throw new Error('请至少提供1题')
 return cases.map((c,i)=>{const query=String(c.query??'').trim(),reference=String(c.reference??'').trim();if(!query||query.length>1000||!reference||reference.length>12000)throw new Error(`第${i+1}题的问题或标准答案为空/超长（问题1000字，标准12000字）`);return {query,reference}})
}
export function parseCases(rows) {
 const header=(rows[0]||[]).map(v=>String(v).trim())
 const q=header.findIndex(v=>/^(问题|题目|question|query)$/i.test(v)),r=header.findIndex(v=>/^(标准答案|标准答案关键词|关键词|reference|answer|keywords)$/i.test(v))
 if(q<0||r<0)throw new Error('表头须包含“问题”和“标准答案”或“标准答案关键词”列')
 return validateCases(rows.slice(1).filter(row=>row.some(v=>String(v??'').trim())).map(row=>({query:row[q],reference:row[r]})))
}
export async function importCases(file){
 if(file.size>5000000)throw new Error('文件不能超过5MB')
 const ext=file.name.split('.').pop().toLowerCase()
 if(ext==='xlsx')return parseCases(await xlsxRows(file))
 const text=(await file.text()).replace(/^\uFEFF/,'')
 if(ext==='csv')return parseCases(csvRows(text))
 if(ext==='json'){const data=JSON.parse(text);return validateCases(Array.isArray(data)?data:data.cases)}
 throw new Error('支持 XLSX、CSV、JSON 格式')
}
export const template=()=>workbookBytes([{name:'问题与标准',rows:[['问题','标准答案'],['含砷废水处理前需要检测哪些指标？','砷浓度、砷形态、pH、共存离子']]}])
export const groupLabels = { A:'直接回答', B:'文档', C:'文档＋图谱', D:'文档＋专家规范', E:'文档＋图谱＋专家规范' }
export function summarizeBatch(job) {
 const groups=Object.keys(groupLabels)
 const total=job?.queries?.length || 0
 const valid=[]
 for(let i=0;i<total;i++) {
  const run=job.summaries?.[i]
  if(groups.every(g=>run?.variants?.[g]?.finishReason!=='length' && Number.isFinite(run?.embeddingEvaluation?.scores?.[g]?.accuracy))) valid.push(run)
 }
 return groups.map(group=>({group,label:groupLabels[group],total,samples:valid.length,score:valid.length ? valid.reduce((sum,run)=>sum+run.embeddingEvaluation.scores[group].accuracy,0)/valid.length : null}))
}
export function report(job){
 const rows=[['题号','问题','标准答案','组别','余弦相似度','标准分','语义相似准确率（%）','状态']]
 job.queries.forEach((q,i)=>{const run=job.summaries[i];for(const g of 'ABCDE'){const score=run?.embeddingEvaluation?.scores?.[g];rows.push([i+1,q,job.references[i],g,score?.similarity??null,run?.embeddingEvaluation?.standardScore??null,score?.accuracy??null,score?'已评分':run?.lastError||'未评分'])}})
 return workbookBytes([{name:'综合评分',rows:[['组别','方法','综合评分（%）','共同有效题数','总题数'],...summarizeBatch(job).map(s=>[s.group,s.label,s.score,s.samples,s.total]),[],['评分口径','仅使用五组均有效且未截断的共同题目，各题等权平均；缺失不补零。衡量语义相似程度，不等同事实正确率。']]},{name:'逐题五组评分',rows}])
}
