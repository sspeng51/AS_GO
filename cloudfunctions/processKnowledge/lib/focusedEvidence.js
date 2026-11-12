const VERSION = 'focused-evidence-v3'
const supported = version => ['focused-evidence-v2', VERSION].includes(version)
const stop = new Set('what which how why were was does did are the a an of for in on to by and or with from during reported used formed occur occurs arsenic removal treatment process material materials study studies'.split(' '))
function terms(query) {
  const english=(String(query).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)||[]).filter(t=>!stop.has(t))
  const chinese=(String(query).match(/[\u3400-\u9fff]{2,}/g)||[]).flatMap(s=>Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2))).filter(t=>!['如何','什么','哪些','发生','处理','过程','中的','含砷','除砷'].includes(t))
  return [...new Set([...english,...chinese])]
}
function score(text, keys) {
  const t=text.toLowerCase()
  return keys.reduce((n,k)=>n+(t.includes(k)?1:0),0)
}
function excerpt(content, query, limit=3500) {
  const text=String(content || '')
  if(text.length<=limit)return {content:text,originalChars:text.length,truncated:false}
  const keys=terms(query), windows=[], width=Math.max(1,Math.min(1200,limit-120)), step=Math.max(1,Math.floor(width*.75))
  // Overlapping windows retain nearby units, qualifiers and tabular values.
  for(let start=0;start<Math.min(text.length,100000);start+=step) windows.push({start,end:Math.min(start+width,text.length),score:score(text.slice(start,start+width),keys)})
  const selected=[],budget=limit-120
  let used=0
  for(const w of windows.sort((a,b)=>b.score-a.score||a.start-b.start)) {
    if(selected.some(s=>w.start<s.end&&w.end>s.start)||used+w.end-w.start>budget)continue
    selected.push(w);used+=w.end-w.start
  }
  selected.sort((a,b)=>a.start-b.start)
  return {content:selected.map(w=>text.slice(w.start,w.end)).join('\n[中间内容省略 / excerpt gap]\n'),originalChars:text.length,truncated:true,windows:selected.map(({start,end})=>({start,end}))}
}
function selectGraph(graph, query) {
  const keys=terms(query),seen=new Set(),kept=[],dropped=[]
  const ranked=graph.map((s,index)=>({...s,index,matchScore:score(`${s.title || ''} ${s.content || ''}`,keys)})).sort((a,b)=>b.matchScore-a.matchScore||a.index-b.index)
  for(const item of ranked) {
    const identity=String(item.content||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()
    const reason=!identity?'empty':seen.has(identity)?'duplicate':!item.matchScore?'no_specific_query_match':kept.length>=4?'graph_budget':null
    if(reason){dropped.push({id:item.id,reason});continue}
    seen.add(identity);kept.push({...item,evidenceRole:'graph_hint'})
  }
  return {sources:kept,diagnostics:{strategy:VERSION,queryTerms:keys,keptIds:kept.map(s=>s.id),dropped}}
}
const instruction = `先在内部列出用户明确要求的子问题（如两个元素、多个条件、优缺点），逐项检查文档证据并覆盖后再输出；不要输出内部检查过程。图谱或规范的加入不能导致已找到的文档要点被遗漏。先回答用户明确提出的每个子问题，再简短说明必要边界。问题要求研究中的参数、步骤或机理时，优先查找同一研究、同一物料体系的文档段落；不要用相似工艺替代。保留来源中的数值、单位、条件与限定词；没有证据的部分明确说明，不能被其他资料的数字补齐。
文档是技术证据；图谱关系是待核验的检索线索，不是完整实验结论。只使用与本题物料、工艺相符的关系补充解释，不因图谱中出现某节点就声称文献证实该关系。数值、反应式和工况结论必须有文档依据；文档与图谱冲突时明确冲突，不混合两套条件。
专家规范只约束证据使用方式，不是额外的必答题或事实来源。仅应用本题触发的规则，避免复述整套规范、无关工艺综述和重复免责声明；先完整回答再说明必要限制。不得引用未提供的编号。`
const bindingInstruction = `回答前逐项核对“研究/物料—工艺阶段—参数名称—数值与单位—结果—文档编号”。同一数值的分子分母、配比对象、气体流量与氧体积分数不可互换；一段与二段、低温与高温、验证试验与优化试验分别核对。化学式、元素来源和阶段顺序逐字核对文档，不能凭相似名称补写。`
const expertInstruction = `将已提供的专家规范作为逐项校验要求：先从文档形成覆盖全部子问题的答案，再检查每项结论的物料、工况和来源是否对应。保留有依据的趋势、机制、参数和限定条件；只纠正冲突或删除无依据扩展，不因增加规范而删掉必要答案。历史研究的事实问答在资料足够时直接回答，不转为追问企业工况。`
const fusionInstruction = `图谱与专家规范联合使用：图谱提供候选关系，先在文档中核验该关系的物料、阶段、方向和适用条件，再由规范检查是否跨体系外推；仅把已核验且能补足问题的关系加入答案。图谱缺少条件时沿用文档限定，不将关系升级为因果或定量结论。对多元素、多阶段问题逐项覆盖，禁止把不同研究的最佳条件拼成一套工艺。最终检查新增解释是否改变原文的对象、数值或顺序。`
function generationInstruction(version, group = {}) {
  if (!supported(version)) return ''
  if (version !== VERSION) return instruction
  return [instruction, bindingInstruction, group.expert ? expertInstruction : '', group.expert && group.graph ? fusionInstruction : ''].filter(Boolean).join('\n')
}
module.exports={VERSION,supported,terms,excerpt,selectGraph,instruction,generationInstruction}
