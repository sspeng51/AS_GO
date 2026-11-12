// Fairly interleave independent searches. The second query must not lose its
// entire allocation merely because the first one returned twelve candidates.
function selectSupplement(pools, existing = [], start = 0) {
  const seen = new Set(existing.map(s => s.content)), result = []
  let budget = 72000
  for (let rank = 0; rank < Math.max(0,...pools.map(p => p.length)); rank++) {
    for (let queryIndex = 0; queryIndex < pools.length; queryIndex++) {
      const item = pools[queryIndex][rank]
      if (!item || item.sourceType === 'neo4j' || result.length >= 12) continue
      const raw = String(item.content || '')
      const content = raw.slice(0,12000)
      if (!content.trim() || seen.has(content) || content.length > budget) continue
      seen.add(content); budget -= content.length
      result.push({id:`S${start+result.length+1}`,title:item.title || '',content,queryIndex,rank:rank+1,originalChars:raw.length,truncated:raw.length>content.length})
    }
  }
  return result
}
module.exports={selectSupplement}
