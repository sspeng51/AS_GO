const groups = {
  A: { label: 'A 大模型直接回答', documents: false, graph: false, expert: false },
  B: { label: 'B 文档 RAG', documents: true, graph: false, expert: false },
  C: { label: 'C 文档 RAG＋知识图谱', documents: true, graph: true, expert: false },
  D: { label: 'D 文档 RAG＋专家规范', documents: true, graph: false, expert: true },
  E: { label: 'E 文档 RAG＋知识图谱＋专家规范', documents: true, graph: true, expert: true }
}
function parseJSON(text) {
  // trim is linear. An unanchored /\s*```\s*$/ retries at every whitespace
  // position on malformed multi-megabyte model output and blocks the server.
  let value = String(text || '').trim()
  if (value.startsWith('```')) {
    value = value.slice(3)
    if (value.slice(0,4).toLowerCase() === 'json') value = value.slice(4)
    value = value.trimStart()
  }
  if (value.endsWith('```')) value = value.slice(0,-3).trimEnd()
  return JSON.parse(value)
}

function validateRubric(value) {
  for (const key of ['points', 'conditions']) {
    if (!Array.isArray(value?.[key]) || !value[key].length || value[key].length > 8 || value[key].some(v => typeof v !== 'string' || !v.trim() || v.length > 300)) throw new Error('评估标准格式错误')
  }
  return { points: value.points, conditions: value.conditions }
}
// Stable excerpt IDs avoid asking the model to reproduce long text byte for byte.
function excerpts(text, prefix = 'A') {
  return (text.match(/[^。！？\n]+[。！？]?|[。！？]/g) || []).map((quote, i) => ({ id: `${prefix}${i + 1}`, quote }))
}
function validateAnswerJudge(value, answer, rubric, sources) {
  const answerQuotes = new Map(excerpts(answer).map(item => [item.id, item.quote]))
  for (const key of ['claims', 'conditions', 'coverage']) {
    if (Array.isArray(value?.[key])) for (const item of value[key]) {
      if (!item || typeof item !== 'object') throw new Error(`${key}条目必须为对象`)
      if (item.quoteId !== undefined) {
        if (!answerQuotes.has(item.quoteId)) throw new Error(`未知回答片段编号：${item.quoteId}`)
        item.quote = answerQuotes.get(item.quoteId)
      }
      if (Array.isArray(item.sourceQuotes)) for (const sourceQuote of item.sourceQuotes) {
        if (!sourceQuote || typeof sourceQuote !== 'object') throw new Error('资料引用必须为对象')
        if (sourceQuote.quoteId !== undefined) {
          const source = sources.find(source => source.id === sourceQuote.id)
          const excerpt = source && excerpts(source.content, `${source.id}:`).find(part => part.id === sourceQuote.quoteId)
          if (!excerpt) throw new Error(`未知资料片段编号：${sourceQuote.quoteId}`)
          sourceQuote.quote = excerpt.quote
        }
      }
    }
  }
  const fail = (message = '结论字段无效、原文不匹配或结论重复') => { throw new Error(message) }
  const tri = v => v === true || v === false || v === null
  const quote = v => typeof v === 'string' && v.trim() && answer.includes(v)
  if (!Array.isArray(value?.claims) || !value.claims.length || value.claims.length > 40) fail('claims须包含1至40条结论')
  const sourceIds = new Set(sources.map(item => item.id))
  // One excerpt can support several different claims. Deduplicate by statement,
  // not by the quoted excerpt; identical repeated rows must not inflate counts.
  const seen = new Map(), unique = []
  for (const claim of value.claims) {
    if (claim.statement !== undefined && (typeof claim.statement !== 'string' || !claim.statement.trim())) fail('statement须为非空结论文本')
    for (const key of ['correct', 'supported', 'citationSupported']) {
      if (['true', 'false', 'null'].includes(claim[key])) claim[key] = JSON.parse(claim[key])
    }
    if (claim.citationSupported === undefined && Array.isArray(claim.citedIds) && !claim.citedIds.length) claim.citationSupported = null
    if (!quote(claim.quote) || !tri(claim.correct) || !tri(claim.supported) || !tri(claim.citationSupported) || typeof claim.reason !== 'string' || !Array.isArray(claim.citedIds)) fail()
    const identity = String(claim.statement || claim.quote).normalize('NFKC').trim()
    const judgement = JSON.stringify([claim.correct, claim.supported, claim.citationSupported, [...claim.citedIds].sort(), claim.score])
    if (seen.has(identity)) {
      if (seen.get(identity) !== judgement) fail('同一结论出现矛盾评分；不同结论请填写不同statement')
      continue
    }
    seen.set(identity, judgement)
    unique.push(claim)
    // A fabricated or unavailable citation cannot count as supported.
    if (claim.citedIds.some(id => typeof id !== 'string' || !sourceIds.has(id) || !answer.includes(`[${id}]`))) claim.citationSupported = false
    if (!claim.citedIds.length) claim.citationSupported = null
    if (claim.citationSupported === true) {
      if (!Array.isArray(claim.sourceQuotes) || !claim.sourceQuotes.length || claim.sourceQuotes.some(item => !claim.citedIds.includes(item.id) || typeof item.quote !== 'string' || !item.quote.trim() || !sources.find(source => source.id === item.id)?.content.includes(item.quote))) fail('引用支持为true时须提供真实资料原文或片段编号')
      if (claim.citedIds.some(id => !claim.sourceQuotes.some(item => item.id === id))) fail('每个受支持的引用都须提供资料原文或片段编号')
    }
  }
  value.claims = unique
  // Do not silently omit citations present in the answer from the denominator.
  for (const match of answer.matchAll(/\[([DG]\d+)\]/g)) {
    if (!value.claims.some(claim => claim.citedIds.includes(match[1]))) fail(`遗漏回答中的引用：${match[1]}`)
  }
  for (const [key, expected, field] of [['conditions', rubric.conditions, 'applicable'], ['coverage', rubric.points, 'covered']]) {
    if (!Array.isArray(value[key]) || value[key].length !== expected.length) fail(`${key}须逐项评分，共${expected.length}项，编号从0开始`)
    const indices = new Set()
    for (const item of value[key]) {
      if (typeof item.point === 'string' && /^\d+$/.test(item.point)) item.point = Number(item.point)
      if (['true', 'false', 'null'].includes(item[field])) item[field] = JSON.parse(item[field])
      if (!Number.isInteger(item.point) || item.point < 0 || item.point >= expected.length || indices.has(item.point) || typeof item.reason !== 'string') fail()
      if (key === 'conditions' ? !tri(item[field]) : typeof item[field] !== 'boolean') fail()
      if (item[field] === true && !quote(item.quote)) fail()
      indices.add(item.point)
    }
  }
  const ratio = (items, key, positive = true) => {
    const known = items.filter(item => typeof item[key] === 'boolean')
    return { value: known.length ? known.filter(item => item[key] === positive).length / known.length : null, numerator: known.filter(item => item[key] === positive).length, denominator: known.length }
  }
  return { ...value, metrics: {
    professionalCorrectness: ratio(value.claims, 'correct'),
    conditionApplicability: ratio(value.conditions, 'applicable'),
    citationSupport: ratio(value.claims.filter(item => item.citedIds.length), 'citationSupported'),
    unsupportedConclusions: ratio(value.claims, 'supported', false),
    answerCoverage: ratio(value.coverage, 'covered')
  }, status: 'model_estimate' }
}
module.exports = { groups, parseJSON, validateRubric, validateAnswerJudge, excerpts }
