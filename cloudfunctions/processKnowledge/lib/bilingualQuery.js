'use strict'

// Lightweight, deterministic bilingual expansion for the copper-smelting / arsenic
// domain. It complements (rather than replaces) multilingual embeddings and the
// upstream retrieval service's query rewriting, so it adds no extra model call.
const CONCEPTS = Object.freeze([
  ['砷', 'arsenic', 'As'],
  ['铜', 'copper', 'Cu'],
  ['硫', 'sulfur', 'sulphur', 'S'],
  ['三氧化二砷', '氧化砷', 'arsenic trioxide', 'As2O3'],
  ['砷酸盐', 'arsenate', 'As(V)', '五价砷'],
  ['亚砷酸盐', 'arsenite', 'As(III)', '三价砷'],
  ['臭葱石', 'scorodite', 'FeAsO4'],
  ['铁', 'iron', 'Fe'],
  ['石灰', 'lime', 'CaO'],
  ['硫化物', 'sulfide', 'sulphide'],
  ['稳定化', 'stabilization', 'stabilisation', '固化稳定化'],
  ['固化', 'solidification'],
  ['絮凝', 'flocculation'],
  ['混凝', 'coagulation'],
  ['沉降', 'settling', 'sedimentation'],
  ['过滤', 'filtration'],
  ['膜分离', 'membrane separation'],
  ['反渗透', 'reverse osmosis'],
  ['生物处理', 'biological treatment'],
  ['生物修复', 'bioremediation'],
  ['酸度', 'pH', '酸碱度'],
  ['氧化还原电位', 'ORP', 'redox potential'],
  ['废渣', '固废', '固体废物', 'solid waste', 'residue'],
  ['砷化氢', 'arsine', 'AsH3'],
  ['硫酸', 'sulfuric acid', 'sulphuric acid', 'H2SO4'],
  ['铜精矿', 'copper concentrate'],
  ['烟尘', 'flue dust', 'smelting dust'],
  ['炉渣', 'slag'],
  ['废水', 'wastewater', 'waste water'],
  ['污泥', 'sludge'],
  ['危险废物', 'hazardous waste'],
  ['熔炼', 'smelting'],
  ['吹炼', 'converting'],
  ['焙烧', 'roasting'],
  ['浸出', 'leaching'],
  ['电解', 'electrolysis'],
  ['挥发', 'volatilization', 'volatilisation'],
  ['沉淀', 'precipitation'],
  ['共沉淀', 'coprecipitation', 'co-precipitation'],
  ['吸附', 'adsorption'],
  ['氧化', 'oxidation'],
  ['还原', 'reduction'],
  ['脱除', '去除', 'removal'],
  ['回收', 'recovery', 'recycling'],
  ['富集', 'enrichment'],
  ['检测', 'detection', 'analysis'],
  ['排放', 'emission', 'discharge'],
  ['温度', 'temperature'],
  ['回收率', 'recovery rate'],
  ['脱砷率', 'arsenic removal rate'],
  ['标准', 'standard'],
  ['限值', 'limit', 'threshold'],
  ['物料物质', 'material', 'substance'],
  ['工艺过程', 'process'],
  ['设备设施', 'equipment', 'facility'],
  ['参数指标', 'parameter', 'indicator'],
  ['产物废料', 'product', 'waste'],
  ['组织机构', 'organization', 'institution'],
  ['环境要素', 'environmental factor'],
  ['化学元素/化合物', 'chemical element', 'compound'],
  ['添加剂', 'additive'],
  ['检测方法', 'analytical method', 'detection method'],
  ['工艺阶段', 'process stage'],
  ['标准规范', 'standard', 'specification']
])

const CJK_RE = /[\u3400-\u9fff]/
const LATIN_RE = /[A-Za-z]/

function normalizeForMatch(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function termAppears(normalizedQuery, term) {
  const normalizedTerm = normalizeForMatch(term)
  if (!normalizedTerm) return false
  // Latin abbreviations such as As/Cu/S must match whole tokens; substring
  // matching would incorrectly treat "wastewater" as containing "As".
  if (/^[a-z0-9][a-z0-9+._/-]*$/i.test(normalizedTerm)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, 'i').test(normalizedQuery)
  }
  return normalizedQuery.includes(normalizedTerm)
}

function uniqueTerms(values, limit = 24) {
  const result = []
  const seen = new Set()
  for (const value of values || []) {
    const term = String(value || '').trim()
    const key = normalizeForMatch(term)
    if (!term || seen.has(key)) continue
    seen.add(key)
    result.push(term)
    if (result.length >= limit) break
  }
  return result
}

function expandBilingualQuery(query, options = {}) {
  const original = String(query || '').trim()
  const normalized = normalizeForMatch(original)
  const matchedGroups = []
  for (const group of CONCEPTS) {
    if (group.some(term => termAppears(normalized, term))) matchedGroups.push(group)
  }
  const terms = uniqueTerms(matchedGroups.flat(), Number(options.maxTerms) || 24)
  const additions = terms.filter(term => !termAppears(normalized, term))
  const expanded = additions.length ? `${original}\nBilingual terms: ${additions.join('; ')}` : original
  return {
    original,
    expanded,
    terms,
    detectedLanguages: [CJK_RE.test(original) ? 'zh' : '', LATIN_RE.test(original) ? 'en' : ''].filter(Boolean),
    queries: uniqueTerms([original, expanded], Number(options.maxQueries) || 2)
  }
}

function aliasesForCanonical(values, concepts = CONCEPTS) {
  const requested = new Set((values || []).map(normalizeForMatch))
  const aliases = []
  for (const group of concepts) {
    if (group.some(term => requested.has(normalizeForMatch(term)))) aliases.push(...group)
  }
  return uniqueTerms([...(values || []), ...aliases], 50)
}

module.exports = { CONCEPTS, expandBilingualQuery, aliasesForCanonical, uniqueTerms, termAppears }
