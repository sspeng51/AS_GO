// Explicit evaluation policy: two document slots then one graph slot, backfill shortages.
// This is a source-balanced selection, not a claim of comparable relevance scores.
function selectEvidence(items, k, mode) {
  if(mode!=='hybrid')return items.slice(0,k)
  const docs=items.filter(e=>e.sourceType!=='neo4j'),graph=items.filter(e=>e.sourceType==='neo4j')
  const out=[];let d=0,g=0
  // With two slots reserve one for each source when both exist.
  if(k===2&&docs.length&&graph.length)return [docs[0],graph[0]]
  while(out.length<k&&(d<docs.length||g<graph.length)){
    for(let i=0;i<2&&out.length<k&&d<docs.length;i++)out.push(docs[d++])
    if(out.length<k&&g<graph.length)out.push(graph[g++])
  }
  return out
}
module.exports={selectEvidence}
