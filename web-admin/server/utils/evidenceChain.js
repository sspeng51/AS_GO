const { assessment } = require('./ragEvaluation')
const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }
function text(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label}须为 1–${max} 字`)
  return value.trim()
}
function validateExperiment(input, { allowIndependent = false } = {}) {
  const name = text(input?.name, '实验名称', 100)
  const corpusVersion = text(input.corpusVersion, '语料版本', 100)
  if (!['knowledge', 'graph', 'hybrid'].includes(input.mode)) fail('检索模式无效')
  if (!Number.isInteger(input.k) || input.k < 1 || input.k > 20) fail('K须为1–20')
  if (typeof input.knowledgeId !== 'string' || !/^([a-zA-Z0-9_-]{1,128})?$/.test(input.knowledgeId)) fail('知识库ID无效')
  if (!Array.isArray(input.cases) || !input.cases.length || input.cases.length > 100) fail('每个实验须有1–100题')
  const cases = input.cases.map(c => {
    if (!c || typeof c !== 'object') fail('问题格式无效')
    if (typeof c.answerable !== 'boolean') fail('须确认库内是否具有充分证据')
    if (!Array.isArray(c.paths) || !c.paths.length || c.paths.length > 5) fail('每题须有1–5条路径')
    return { query: text(c.query, '问题'), answerable: c.answerable, paths: c.paths.map(p => {
      if (!p || typeof p !== 'object') fail('路径格式无效')
      if (!Array.isArray(p.points) || !p.points.length || p.points.length > 20) fail('每条路径须有1–20个事实')
      const points = p.points.map(v => ({ text: text(v?.text, '必需事实', 500), source: text(v?.source, '金标准来源定位', 1000) }))
      if (!Array.isArray(p.links) || p.links.length > 40) fail('连接最多40条')
      const pairs = new Set()
      const links = p.links.map(l => {
        if (!l || typeof l !== 'object') fail('连接格式无效')
        if (![l.from,l.to].every(n => Number.isInteger(n) && n >= 0 && n < points.length) || l.from === l.to) fail('连接端点无效')
        const key = `${l.from}:${l.to}`; if (pairs.has(key)) fail('连接不能重复'); pairs.add(key)
        return { from:l.from, to:l.to, condition:text(l.condition, '连接依据及条件', 1000) }
      })
      const reached = new Set([0]); let changed = true
      while (changed) { changed = false; for (const l of links) if (reached.has(l.from) || reached.has(l.to)) for (const n of [l.from,l.to]) if (!reached.has(n)) { reached.add(n); changed = true } }
      const independent=allowIndependent&&p.structure==='set'&&links.length===0
      if (!independent && reached.size !== points.length) fail('每条证据路径的所有事实须由必要连接串联；单事实路径可无连接')
      return { name:text(p.name, '路径名称', 100), points, links, ...(allowIndependent?{structure:independent?'set':'chain'}:{}) }
    }) }
  })
  if (new Set(cases.map(c=>c.query)).size !== cases.length) fail('同一实验的问题不能重复')
  return { name, corpusVersion, mode: input.mode, k: input.k, knowledgeId: input.mode === 'graph' ? '' : input.knowledgeId, cases }
}
function validateReview(paths, input, run) {
  if (!Array.isArray(input) || input.length !== paths.length) fail('复核路径与标准不一致')
  const evidence = new Map((run.results || []).map(e=>[e.evaluationId,e]))
  const status = v => { if (![null,true,false].includes(v)) fail('复核状态须为待判定、通过或不通过'); return v }
  return paths.map((p,i)=>{
    const r=input[i]
    if (!r || !Array.isArray(r.points) || r.points.length!==p.points.length || !Array.isArray(r.links) || r.links.length!==p.links.length) fail('复核条目与标准不一致')
    return { points:r.points.map(v=>{
      if (!v || typeof v !== 'object') fail('事实复核格式无效')
      const supported=status(v.supported)
      const note=typeof v.note==='string'?v.note.slice(0,1000):''
      const citations = Array.isArray(v.citations) ? v.citations : []
      if (citations.length>20) fail('每个事实最多关联20条证据')
      const clean=citations.map(c=>{
        if (!c || typeof c !== 'object') fail('引用格式无效')
        const e=evidence.get(c.id); if(!e)fail('引用必须来自本次Top-k证据')
        const quote=text(c.quote,'支持原文',2000)
        if(!(e.content||'').includes(quote))fail('支持原文必须是检索证据中的连续原文')
        return {id:c.id,quote,locator:text(c.locator,'实际原文定位',1000)}
      })
      if(supported===true&&!clean.length)fail('判定覆盖须提供引用、原文及来源定位')
      return { supported, citations:clean, note }
    }), links:r.links.map(l=>({valid:status(l?.valid),reason:l?.valid===null?'':text(l?.reason,'连接判定依据',1000)})) }
  })
}
function metrics(entry) {
  if(!entry.standard.answerable)return {coverage:null,chain:null,state:'库内证据不足'}
  if(!assessment(entry.run).eligible)return {coverage:null,chain:null,state:'检索失败或降级'}
  if(!entry.run.results.length)return {coverage:0,chain:0,state:'有效空结果'}
  const review=entry.review
  if(!review)return {coverage:null,chain:null,state:'待复核'}
  const pointsDone=review.every(p=>p.points.every(v=>v.supported!==null))
  const linksDone=review.every(p=>p.links.every(v=>v.valid!==null))
  const coverage=pointsDone?Math.max(...review.map(p=>p.points.filter(v=>v.supported).length/p.points.length)):null
  const chain=pointsDone&&linksDone?Number(review.some(p=>p.points.every(v=>v.supported)&&p.links.every(v=>v.valid))):null
  return {coverage,chain,state:chain===null?'待完成复核':'已复核'}
}
function report(experiment) {
  const entries=(experiment.entries||[]).map(e=>({...e,metrics:metrics(e)}))
  const mean=key=>{const values=entries.map(e=>e.metrics[key]).filter(v=>v!==null);return {value:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,samples:values.length}}
  return {...experiment,entries,summary:{coverage:mean('coverage'),chain:mean('chain'),total:experiment.cases.length,executed:entries.length}}
}
module.exports={validateExperiment,validateReview,metrics,report}
