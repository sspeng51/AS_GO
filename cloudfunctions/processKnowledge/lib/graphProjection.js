'use strict'
// Keep the same graph facts and the same 300-character descriptions used by
// normalizeGraphRecords, but avoid transferring entire source documents per node.
function projectGraphQuery(cypher, schema) {
  const properties=new Set((schema.nodes||[]).flatMap(n=>n.properties||[]))
  const descriptions=['desc','description','summary','content','text'].filter(p=>properties.has(p)).map(p=>`n.${p}`)
  const description=descriptions.length?`substring(toString(coalesce(${descriptions.join(', ')}, $emptyText)), 0, 300)`:'$emptyText'
  const relationProperties=new Set((schema.relationships||[]).flatMap(r=>r.properties||[]))
  const nodes=`[n IN nodes(p) | {elementId: elementId(n), properties: {name: n.name, desc: ${description}}}]`
  const relationships=`[edge IN relationships(p) | {type: type(edge), startNodeElementId: elementId(startNode(edge)), properties: {type: ${relationProperties.has('type')?'edge.type':'type(edge)'}}}]`
  const ending='RETURN nodes(p) AS nodes, relationships(p) AS relationships'
  if(!cypher.includes(ending))throw new Error('图谱投影只适用于已验证的路径查询')
  return cypher.replace(ending,`RETURN ${nodes} AS nodes, ${relationships} AS relationships`)
}
module.exports={projectGraphQuery}
