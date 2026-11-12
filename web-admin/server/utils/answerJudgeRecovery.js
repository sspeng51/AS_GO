const { excerpts, validateAnswerJudge } = require('./answerComparison')

// Preserve good dimensions when another dimension is incomplete. Missing
// annotations never become a zero, a pass, or a smaller hidden denominator.
function recoverLegacy(input, answer, rubric, sources) {
  try { return { ...validateAnswerJudge(structuredClone(input), answer, rubric, sources), warnings: [] } } catch {}
  if (!input || typeof input !== 'object' || !['claims', 'conditions', 'coverage'].some(key => Array.isArray(input[key]))) throw new Error('未返回可识别的评分结构')
  const warnings = [], blocked = new Set(), parts = new Map(excerpts(answer).map(p => [p.id, p.quote]))
  const tri = v => typeof v === 'boolean' || v === null ? v : ['true', 'false', 'null'].includes(v) ? JSON.parse(v) : null
  const rawQuote = item => {
    const id = typeof item?.quoteId === 'string' ? item.quoteId.trim() : ''
    const text = parts.get(id) || item?.quote
    return typeof text === 'string' && text.trim() && answer.includes(text) ? text : null
  }
  const block = (metric, message) => { blocked.add(metric); warnings.push(message) }
  const claims = [], seen = new Map()
  if (!Array.isArray(input.claims) || !input.claims.length || input.claims.length > 40) {
    block('professionalCorrectness', '技术结论标注不完整'); blocked.add('unsupportedConclusions'); blocked.add('citationSupport')
  }
  for (const original of (Array.isArray(input.claims) ? input.claims : []).slice(0, 40)) {
    const quote = rawQuote(original)
    if (!quote) {
      block('professionalCorrectness', '存在无法定位原文的结论，待复核'); blocked.add('unsupportedConclusions'); blocked.add('citationSupport'); continue
    }
    for (const [field, metric] of [['correct', 'professionalCorrectness'], ['supported', 'unsupportedConclusions']]) {
      if (![true, false, null, 'true', 'false', 'null'].includes(original[field])) block(metric, `结论${field}标注缺失或无效`)
    }
    const claim = { ...original, quote, correct: tri(original.correct), supported: tri(original.supported), citationSupported: tri(original.citationSupported), reason: String(original.reason || '') }
    delete claim.quoteId
    claim.citedIds = [...new Set((Array.isArray(original.citedIds) ? original.citedIds : []).filter(id => typeof id === 'string').map(id => id.replace(/^\[|\]$/g, '').trim()))]
    const identity = String(claim.statement || quote).normalize('NFKC').trim()
    if (seen.has(identity)) {
      const prior = seen.get(identity)
      for (const [field, metric] of [['correct', 'professionalCorrectness'], ['supported', 'unsupportedConclusions'], ['citationSupported', 'citationSupport']]) {
        if (prior[field] !== claim[field]) block(metric, '同一结论有矛盾评分，受影响指标待复核')
      }
      if (prior.score !== claim.score) block('professionalCorrectness', '同一结论有矛盾分级，待复核')
      continue
    }
    seen.set(identity, claim)
    if (!claim.citedIds.length) claim.citationSupported = null
    else if (claim.citedIds.some(id => !sources.some(s => s.id === id) || !answer.includes(`[${id}]`))) claim.citationSupported = false
    else if (claim.citationSupported === true) {
      const quotes = (Array.isArray(original.sourceQuotes) ? original.sourceQuotes : []).map(item => {
        const source = sources.find(s => s.id === item?.id)
        const quote = source && (excerpts(source.content, `${source.id}:`).find(p => p.id === item.quoteId)?.quote || item.quote)
        return { id: item?.id, quote: typeof quote === 'string' && quote.trim() && source.content.includes(quote) ? quote : null }
      })
      if (claim.citedIds.some(id => !quotes.some(q => q.id === id && q.quote))) {
        claim.citationSupported = null; block('citationSupport', '部分引用缺少可定位的资料原文，引用支持率待复核')
      }
      claim.sourceQuotes = quotes.filter(q => q.quote)
    }
    claims.push(claim)
  }
  const missingCitations = [...new Set([...answer.matchAll(/\[([DG]\d+)\]/g)].map(m => m[1]))].filter(id => !claims.some(c => c.citedIds.includes(id)))
  if (missingCitations.length) block('citationSupport', `引用标注不完整：${missingCitations.join('、')}；其余指标保留`)
  const normalizePoints = (key, field, expected, metric) => {
    const rows = Array.isArray(input[key]) ? input[key] : []
    const indices = rows.map(row => Number(row?.point))
    const oneBased = rows.length === expected.length && new Set(indices).size === expected.length && indices.every(n => Number.isInteger(n) && n >= 1 && n <= expected.length)
    if (oneBased) warnings.push(`${key}编号已从1起始转换为0起始`)
    return expected.map((_, point) => {
      const matching = rows.filter(row => row?.point !== '' && row?.point != null && Number(row.point) - (oneBased ? 1 : 0) === point)
      if (matching.length !== 1) { block(metric, `${key}第${point + 1}项缺失或重复，待复核`); return { point, [field]: null, reason: '缺少有效标注' } }
      const item = matching[0], quote = rawQuote(item), value = tri(item[field])
      if (![true, false, null, 'true', 'false', 'null'].includes(item[field])) block(metric, `${key}第${point + 1}项评分缺失或无效`)
      if ((value === true && !quote) || (key === 'coverage' && value === null)) {
        block(metric, `${key}第${point + 1}项依据不完整，待复核`)
        return { point, [field]: null, reason: '缺少有效依据' }
      }
      return { ...item, point, quote, [field]: value }
    })
  }
  const conditions = normalizePoints('conditions', 'applicable', rubric.conditions, 'conditionApplicability')
  const coverage = normalizePoints('coverage', 'covered', rubric.points, 'answerCoverage')
  const ratio = (key, rows, field, positive = true) => {
    const known = rows.filter(row => typeof row[field] === 'boolean'), numerator = known.filter(row => row[field] === positive).length
    return { value: blocked.has(key) || !known.length ? null : numerator / known.length, numerator, denominator: known.length, expected: rows.length, complete: !blocked.has(key), reason: blocked.has(key) ? '标注不完整，未纳入该指标均值' : null }
  }
  return { claims, conditions, coverage, missingCitations, warnings: [...new Set(warnings)], status: blocked.size ? 'partial' : 'model_estimate', metrics: {
    professionalCorrectness: ratio('professionalCorrectness', claims, 'correct'),
    unsupportedConclusions: ratio('unsupportedConclusions', claims, 'supported', false),
    citationSupport: ratio('citationSupport', claims.filter(c => c.citedIds.length), 'citationSupported'),
    conditionApplicability: ratio('conditionApplicability', conditions, 'applicable'),
    answerCoverage: ratio('answerCoverage', coverage, 'covered')
  } }
}
function recoverAnswerJudge(input, answer, rubric, sources, scoringVersion) {
  const fine = scoringVersion === 'analytic-100-v2'
  const scale = fine ? 100 : 4, threshold = fine ? 75 : 3
  if (fine || scoringVersion === 'anchored-v1') {
    input = structuredClone(input)
    // The anchored score is authoritative; derive the legacy boolean schema
    // locally so a model need not emit two mutually consistent encodings.
    for (const [key, field] of [['claims', 'correct'], ['conditions', 'applicable'], ['coverage', 'covered']]) {
      for (const item of Array.isArray(input?.[key]) ? input[key] : []) {
        if (!item || typeof item !== 'object') continue
        if (fine) {
          const limits = key === 'claims' ? [60,25,15] : [40,35,25]
          const parts = ['core','depth','boundary'].map(k => item.breakdown?.[k])
          item.score = (item.breakdown === null || item.score === null) && key !== 'coverage' ? null : parts.every((n,i) => Number.isInteger(n) && n >= 0 && n <= limits[i]) && typeof item.reason === 'string' && item.reason.trim() ? parts.reduce((a,b)=>a+b,0) : undefined
          if (key === 'claims') {
            item.supported = Number.isInteger(item.supportScore) ? item.supportScore >= 75 : null
            item.citationSupported = item.citedIds?.length && Number.isInteger(item.citationScore) ? item.citationScore > 0 : null
          }
        }
        if (typeof item.score === 'string' && /^[0-4]$/.test(item.score)) item.score = Number(item.score)
        if (Number.isInteger(item.score) && item.score >= 0 && item.score <= scale) item[field] = item.score >= threshold
        else if (item.score === null && key !== 'coverage') item[field] = null
      }
    }
  }
  const result = recoverLegacy(input, answer, rubric, sources)
  const unsupported = result.metrics.unsupportedConclusions
  result.metrics.supportedConclusions = { ...unsupported, value: Number.isFinite(unsupported.value) ? 1 - unsupported.value : null, numerator: unsupported.denominator - unsupported.numerator }
  if (!fine && scoringVersion !== 'anchored-v1') return result
  for (const [key, rows, field] of [
    ['professionalCorrectness', result.claims, 'correct'],
    ['conditionApplicability', result.conditions, 'applicable'],
    ['answerCoverage', result.coverage, 'covered']
  ]) {
    let invalid = result.metrics[key].complete === false
    const known = []
    for (const item of rows) {
      const score = item.score
      if (score === null && key !== 'answerCoverage' && item[field] === null) continue
      if (!Number.isInteger(score) || score < 0 || score > scale || (score > 0 && !(typeof item.quote === 'string' && item.quote.trim() && answer.includes(item.quote))) || item[field] !== (score >= threshold)) { invalid = true; continue }
      known.push(score)
    }
    const sum = known.reduce((n, score) => n + score, 0)
    result.metrics[key] = { value: invalid || !known.length ? null : sum / (known.length * scale), score: invalid || !known.length ? null : sum / known.length, scale, numerator: sum, denominator: known.length * scale, expected: rows.length, complete: !invalid }
    if (invalid) { result.warnings.push(`${({professionalCorrectness:'专业准确性',conditionApplicability:'工况适配性',answerCoverage:'回答完整性'})[key]}：分项得分缺失、越界或原文依据不完整`); result.status = 'partial' }
  }
  if (fine) {
    for (const [key, field, rows] of [
      ['citationSupport','citationScore',result.claims.filter(c=>c.citedIds.length)],
      ['supportedConclusions','supportScore',result.claims]
    ]) {
      let invalid = result.metrics[key].complete === false
      const values = []
      for (const row of rows) {
        if (row[field] === null) continue
        if (!Number.isInteger(row[field]) || row[field] < 0 || row[field] > 100 || !row.reason?.trim()) { invalid = true; continue }
        // A fabricated citation can never earn partial citation credit.
        values.push(key === 'citationSupport' && row.citationSupported === false ? 0 : row[field])
      }
      const numerator = values.reduce((a,b)=>a+b,0)
      result.metrics[key] = {value: invalid || !values.length ? null : numerator / (values.length * 100), numerator, denominator: values.length * 100, scale:100, expected:rows.length, complete:!invalid}
      if (invalid) { result.status='partial'; result.warnings.push(`${key === 'citationSupport' ? '引用支撑质量' : '结论依据充分性'}：逐结论分数或证据缺失，待补评`) }
    }
    // Citation inventory is independent of the claims selected by the judge.
    // Every cited source must be checked; no missing item becomes a zero/pass.
    if (Array.isArray(input.citationReviews)) {
      const expected = [...new Set([...answer.matchAll(/\[([DG]\d+)\]/g)].map(m => m[1]))]
      const values = [], issues = []
      for (const id of expected) {
        const rows = input.citationReviews.filter(row => row?.id === id)
        const row = rows[0], source = sources.find(s => s.id === id)
        if (rows.length !== 1 || !Number.isInteger(row.score) || row.score < 0 || row.score > 100 || !row.reason?.trim()) { issues.push(id); continue }
        const quote = excerpts(answer).find(p => p.id === row.quoteId)?.quote
        const sourceQuote = source && excerpts(source.content, `${id}:`).find(p => p.id === row.sourceQuoteId)?.quote
        if (!quote?.includes(`[${id}]`) || (source && row.score > 0 && !sourceQuote)) { issues.push(id); continue }
        values.push(source ? row.score : 0)
      }
      const sum = values.reduce((a,b)=>a+b,0)
      result.citationReviews = input.citationReviews
      result.metrics.citationSupport = {value: issues.length || !values.length ? null : sum/(values.length*100), numerator:sum, denominator:values.length*100, expected:expected.length, complete:!issues.length, unit:'cited_source'}
      result.warnings = result.warnings.filter(w=>!w.includes('引用'))
      if (issues.length) result.warnings.push(`引用核验缺失或依据无效：${issues.join('、')}`)
      result.status = ['professionalCorrectness','conditionApplicability','answerCoverage','citationSupport','supportedConclusions'].some(k=>result.metrics[k].complete===false) ? 'partial' : 'model_estimate'
    }
  }
  result.scoringVersion = scoringVersion
  return result
}
module.exports = { recoverAnswerJudge }
