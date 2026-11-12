'use strict'
const {CONCEPTS,termAppears}=require('./bilingualQuery')
const EXTRA=[['形态','speciation','species','chemical form'],['无机砷','inorganic arsenic','arsenite','arsenate','As(III)','As(V)'],['价态','valence','oxidation state'],['溶解','dissolution','dissolve'],['迁移','migration','mobility','mobilization'],['释放','release','leaching'],['锰','manganese','Mn'],['矿物','mineral'],['洗涤','scrubbing','washing'],['萃取','extraction','extractant'],['吸附','adsorption','adsorb','adsorbed'],['水溶液','aqueous','solution']]
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'')
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
function patterns(terms){return [...new Set(terms.map(norm).filter(Boolean))].slice(0,20).map(t=>`(?is).*${/^[a-z]{1,2}$/.test(t)?`(?<![a-z0-9])${escape(t)}(?![a-z0-9])`:escape(t)}.*`)}
function groupsFor(query,plan){
 const groups=(plan.entities||[]).slice(0,4).map(e=>[e,...(plan.entityAliases?.[e]||[])])
 for(const g of [...CONCEPTS,...EXTRA])if(g.some(t=>termAppears(String(query).normalize('NFKC').toLowerCase(),t))&&!groups.some(v=>v.some(t=>g.includes(t))))groups.push(g)
 return groups.slice(0,10)
}
// Trusted parameterized query builder. No model-generated Cypher is executed here.
function candidateQueries(query,plan,schema){
 const groups=groupsFor(query,plan),properties=new Set((schema.nodes||[]).flatMap(n=>n.properties||[]))
 const names=['name','name_zh','name_en','title','label'].filter(p=>properties.has(p))
 if(!groups.length||!names.length)return []
 const fields=['desc','description','summary'].filter(p=>properties.has(p))
 const text=(v,props)=>props.map(p=>`replace(toLower(substring(toString(coalesce(${v}.${p}, $emptyText)),0,500)), $space, $emptyText)`).join(' + $separator + ')
 const seed=text('a',names),body=`${text('a',[...names,...fields])} + $separator + ${text('b',[...names,...fields])} + $separator + toLower(type(r)) + $separator + toLower(toString(coalesce(r.type,$emptyText)))`
 const params={emptyText:'',space:' ',separator:'|',seedLimit:80,limit:60}
 groups.forEach((g,i)=>params[`rank${i}`]=patterns(g))
 const score=value=>groups.map((g,i)=>`CASE WHEN ANY(t IN $rank${i} WHERE (${value}) =~ t) THEN ${g.some(t=>['砷','arsenic','As'].includes(t))?1:3} ELSE 0 END`).join(' + ')
 // Separate streams prevent the high-degree generic As node monopolising candidates.
 return groups.slice(0,4).map((g,i)=>({params,cypher:`MATCH (a) WHERE ANY(t IN $rank${i} WHERE (${seed}) =~ t) WITH a, (${score(seed)}) AS seedScore ORDER BY seedScore DESC, elementId(a) LIMIT $seedLimit MATCH p=(a)-[r]-(b) WITH p, (${score(body)}) AS relevance ORDER BY relevance DESC, elementId(r) RETURN nodes(p) AS nodes, relationships(p) AS relationships LIMIT $limit`}))
}
function rankFacts(facts,query,plan,limit){
 const groups=groupsFor(query,plan).map(g=>({patterns:patterns(g).map(p=>new RegExp(p.replace('(?is)',''),'is')),weight:g.some(t=>['砷','arsenic','As'].includes(t))?1:3}))
 const intentGroups=EXTRA.filter(g=>g.some(t=>termAppears(String(query).normalize('NFKC').toLowerCase(),t))).map(g=>g[0]==='价态'?[...g,'As(III)','As(V)','arsenite','arsenate','species','speciation','三价','五价']:g)
 return facts.map((fact,index)=>{
  const title=norm(fact.title),content=norm(fact.content)
  let score=groups.reduce((s,g)=>s+(g.patterns.some(p=>p.test(title))?g.weight*2:g.patterns.some(p=>p.test(content))?g.weight:0),0)
  const covered=intentGroups.filter(g=>patterns(g).some(p=>new RegExp(p.replace('(?is)',''),'is').test(content))).length
  score+=covered*4+(intentGroups.length>1&&covered===intentGroups.length?12:0)
  if(!/作者|文献|论文|author|paper|publication/i.test(query)&&/(?:\n作者\s*$|—[^→]*→\s*(?:Fig\.|Figure|Table|Scheme)\s*\d)/i.test(fact.content))score-=25
  if(fact.nodes?.length===2&&norm(fact.nodes[0])===norm(fact.nodes[1]))score-=20
  return {...fact,retrievalScore:score,_order:index}
 }).sort((a,b)=>b.retrievalScore-a.retrievalScore||a._order-b._order).slice(0,limit).map(({_order,...f})=>f)
}
module.exports={candidateQueries,rankFacts,groupsFor,patterns}
