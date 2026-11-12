function invalid(message) { return Object.assign(new Error(`模型初评校验失败：${message}`), { status: 502 }) }
const compact = text => text.normalize('NFKC').replace(/\s+/gu, '')
function validateJudge(answer, input) {
  let value
  try { value = JSON.parse(answer.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) } catch { throw invalid('不是有效 JSON') }
  if (!value || !Array.isArray(value.grades)) throw invalid('缺少 grades 数组')
  const byId = new Map(input.results.flatMap(item => [[item.id, item], [item.sourceId, item]]).filter(([id]) => id))
  const resolve = id => byId.get(String(id))
  const seen = new Set()
  const grades = value.grades.map(item => {
    const source = item && resolve(item.id)
    if (!source) throw invalid('资料 ID 不在本次检索结果内')
    if (seen.has(source.id)) throw invalid(`资料 ${source.id} 重复评分`)
    seen.add(source.id)
    const parts = item.breakdown
    const hasParts = parts && ['directness','scope','detail'].every((key,i)=>Number.isInteger(parts[key]) && parts[key]>=0 && parts[key]<=[50,30,20][i])
    if (input.requireBreakdown && !hasParts) throw invalid(`${source.id} 缺少有效分项分数（50/30/20）`)
    const score = hasParts ? parts.directness+parts.scope+parts.detail : item.relevanceScore
    const grade = hasParts ? (score<20?0:score<60?1:2) : typeof item.grade === 'string' && /^[012]$/.test(item.grade.trim()) ? Number(item.grade) : item.grade
    if (![0, 1, 2].includes(grade)) throw invalid(`${source.id} 相关等级须为 0、1、2`)
    if (typeof item.reason !== 'string' || !item.reason.trim()) throw invalid(`${source.id} 缺少评分理由`)
    let quote = typeof item.quote === 'string' ? item.quote.trim() : ''
    const rawIds = item.quoteIds ?? (item.quoteId !== undefined ? [item.quoteId] : /^E\d+$/.test(quote) ? [quote] : [])
    if (!Array.isArray(rawIds)) throw invalid(`${source.id} quoteIds须为数组`)
    if (rawIds.length) {
      const fragments = rawIds.map(raw=>{
        const id=typeof raw==='number' ? `E${raw}` : String(raw).trim().replace(new RegExp(`^${source.id}[:：/.-]`),'')
        const excerpt=source.excerpts?.find(part=>part.id===id)
        if(!excerpt)throw invalid(`${source.id} 引文编号不存在`)
        return excerpt.text
      })
      quote = fragments.join('\n')
    }
    if (grade > 0 || (input.requireBreakdown && score > 0)) {
      const normalized = compact(quote.replace(/^[“"「『]|[”"」』]$/gu, ''))
      if (!normalized || (!rawIds.length && !compact(source.content).includes(normalized))) throw invalid(`${source.id} 引文不是原文片段，请选择 quoteId`)
    }
    if (input.requireFine && score === undefined) throw invalid(`${source.id} 缺少百分制相关性分数`)
    if (score !== undefined && (!Number.isInteger(score) || score < 0 || score > 100 || grade !== (score < 20 ? 0 : score < 60 ? 1 : 2))) throw invalid(`${source.id} 细评分与相关等级不一致`)
    return { id: source.sourceId || source.id, grade, reason: item.reason, quote, ...(hasParts?{breakdown:parts}:{}), ...(score === undefined ? {} : {relevanceScore:score}) }
  })
  if (seen.size !== input.results.length) throw invalid('未对每条资料评分')
  if (!Array.isArray(value.coverage)) throw invalid('缺少 coverage 数组')
  const covered = new Set()
  const coverage = value.coverage.map(item => {
    const point = typeof item?.point === 'string' && /^\d+$/.test(item.point) ? Number(item.point) : item?.point
    if (!Number.isInteger(point) || point < 0 || point >= input.evidencePoints.length || covered.has(point)) throw invalid('证据点编号越界或重复，编号从 0 开始')
    covered.add(point)
    if (!Array.isArray(item.ids) || !item.ids.length) throw invalid(`证据点 ${point} 缺少支持资料 ID`)
    const ids = item.ids.map(id => {
      const source = resolve(id)
      if (!source) throw invalid(`证据点 ${point} 引用了不存在的资料`)
      const originalId = source.sourceId || source.id
      if (!grades.some(grade => grade.id === originalId && grade.grade > 0)) throw invalid(`证据点 ${point} 引用了判为无关的资料`)
      return originalId
    })
    return { point, ids: [...new Set(ids)] }
  })
  if (typeof value.sufficiency !== 'string') throw invalid('缺少充分性说明')
  return { grades, coverage, sufficiency: value.sufficiency }
}
module.exports = { validateJudge }
