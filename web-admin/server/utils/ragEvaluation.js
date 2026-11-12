const crypto = require('crypto')

function evidenceId(item) {
  const source = item.sourceType || item.searchMode || 'zhipu'
  // Provider fallback IDs and graph IDs depend on rank; never use those as gold IDs.
  const key = `${source === 'neo4j' ? '' : (item.knowledgeBaseId || item.zhipuMeta?.knowledgeId || '')}\n${item.chunkId || `${item.documentId || item.title || ''}\n${item.content || ''}`}`
  return `${source}:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`
}

function normalizeEvidence(items, knowledgeBaseId = '') {
  const seen = new Set()
  return (items || []).map(item => ({ ...item, evaluationId: evidenceId({ ...item, knowledgeBaseId }) }))
    .filter(item => !seen.has(item.evaluationId) && seen.add(item.evaluationId))
}

function assessment(run) {
  const info = run.sourceInfo || {}
  const mode = run.retrievalMode || info.searchMode || 'hybrid'
  const z = info.zhipu || {}
  const g = info.neo4j || {}
  const usesKnowledge = mode !== 'graph'
  const usesGraph = mode !== 'knowledge'
  const fallbacks = usesKnowledge && Array.isArray(z.retrievalFallbacks) ? z.retrievalFallbacks : []
  const knownFallback = fallbacks.length > 0 && fallbacks.every(item => ['rerank_cooldown', 'rerank_unavailable'].includes(item?.reason))
  const queryCount = z.queryVariants?.length
  const rerankMode = !usesKnowledge ? 'not_applicable'
    : knownFallback ? (queryCount === fallbacks.length ? 'fallback_off' : 'fallback_mixed')
      : run.effectiveConfig?.retrieval?.rerankStatus === 1 ? 'enabled'
        : run.effectiveConfig?.retrieval?.rerankStatus === 0 ? 'disabled' : 'unknown'
  let warning = ''
  let eligible = true
  if (run.error) { eligible = false; warning = run.error }
  else if (usesKnowledge && (z.success === false || z.error || z.partialFailure)) {
    eligible = false; warning = z.partialFailure ? '知识库部分查询失败，结果不完整，暂不计分。' : '知识库检索失败，暂不计分。'
  } else if (usesGraph && !g.skipped && (g.success === false || g.error)) {
    eligible = false; warning = '知识图谱检索失败，暂不计分。'
  } else if (run.degraded || info.degraded || (usesKnowledge && z.degraded)) {
    // Only explicitly recognized rerank recovery can waive the old degradation gate.
    eligible = knownFallback && z.success === true && z.partialFailure === false
    warning = eligible
      ? (rerankMode === 'fallback_off' ? '知识库检索成功，本次未重排（重排服务回退）；可正常标注和评分，统计单独分组。' : '知识库检索成功，部分查询发生重排回退；可正常标注和评分，统计单独分组。')
      : '检索存在未确认的降级，暂不计分；请查看来源诊断。'
  }
  return { eligible, rerankMode, warning }
}

function evaluate(run) {
  const testCase = run.testCase || {}
  const results = (run.results || []).slice(0, run.k)
  const gold = new Map((testCase.references || []).map(item => [item.id, item.grade]))
  const human = run.review?.grades || {}
  const complete = testCase.referencesComplete === true
  const grades = results.map(item => human[item.evaluationId] ?? gold.get(item.evaluationId) ?? (complete ? 0 : null))
  const allJudged = grades.every(grade => grade !== null)
  const relevant = [...gold.entries()].filter(([, grade]) => grade > 0)
  const status = assessment(run)
  const healthy = status.eligible
  const knownAnswerability = typeof testCase.noAnswer === 'boolean'
  const dcg = values => values.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0)
  const ideal = dcg([...gold.values()].sort((a, b) => b - a).slice(0, run.k))
  // Ranking metrics use confirmed labels only; AI suggestions never silently become ground truth.
  // Recall/nDCG use the case's complete reference set, not per-run ad hoc judgments.
  const goldGrades = results.map(item => gold.get(item.evaluationId) || 0)
  const first = grades.findIndex(grade => grade > 0)
  const coverage = run.review?.coveredPoints
  const pointCount = (testCase.evidencePoints || []).length
  return {
    ...status,
    precisionAtK: healthy && allJudged ? grades.filter(grade => grade > 0).length / run.k : null,
    recallAtK: healthy && complete && relevant.length ? results.filter(item => (gold.get(item.evaluationId) || 0) > 0).length / relevant.length : null,
    mrr: healthy && allJudged ? (first < 0 ? 0 : 1 / (first + 1)) : null,
    hitRate: healthy && allJudged ? Number(first >= 0) : null,
    contextRelevance: healthy && allJudged && grades.length ? grades.reduce((sum, grade) => sum + grade, 0) / (2 * grades.length) : null,
    ndcgAtK: healthy && complete && ideal > 0 ? dcg(goldGrades) / ideal : null,
    evidenceCoverage: healthy && pointCount && Array.isArray(coverage) ? coverage.length / pointCount : null,
    noAnswerCorrect: healthy && knownAnswerability ? Number(testCase.noAnswer === (results.length === 0)) : null,
    falseRecall: healthy && testCase.noAnswer === true ? Number(results.length > 0) : null,
    latencyMs: Number.isFinite(run.latencyMs) ? run.latencyMs : null,
    empty: healthy ? Number(results.length === 0) : null,
    cost: null,
    judged: grades.filter(grade => grade !== null).length,
    returned: results.length
  }
}

function summarize(runs) {
  const metrics = runs.map(evaluate)
  const mean = key => {
    const values = metrics.map(item => item[key]).filter(value => typeof value === 'number' && Number.isFinite(value))
    return { value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, samples: values.length }
  }
  const latencies = metrics.map(item => item.latencyMs).filter(Number.isFinite).sort((a, b) => a - b)
  return {
    count: runs.length,
    failed: metrics.filter(item => !item.eligible).length,
    rerankFallback: metrics.filter(item => item.eligible && item.rerankMode.startsWith('fallback_')).length,
    p95LatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null,
    ...Object.fromEntries(['precisionAtK', 'recallAtK', 'mrr', 'ndcgAtK', 'hitRate', 'contextRelevance', 'evidenceCoverage', 'noAnswerCorrect', 'falseRecall', 'empty'].map(key => [key, mean(key)]))
  }
}

function validateCase(input) {
  if (input?.retrievalMode !== undefined && !['knowledge', 'graph', 'hybrid'].includes(input.retrievalMode)) throw new Error('检索模式无效')
  if (!input || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 1000) throw new Error('问题长度须为 1–1000 字')
  if (!Array.isArray(input.references) || input.references.length > 200) throw new Error('标准资料最多 200 条')
  const ids = new Set()
  for (const ref of input.references) {
    if (!ref || typeof ref.id !== 'string' || !ref.id || ref.id.length > 100 || ![0, 1, 2].includes(ref.grade) || ids.has(ref.id)) throw new Error('标准资料 ID 不能重复，相关等级必须为 0/1/2')
    ids.add(ref.id)
  }
  if (!Array.isArray(input.evidencePoints) || input.evidencePoints.length > 30 || input.evidencePoints.some(point => typeof point !== 'string' || !point.trim() || point.length > 500)) throw new Error('证据点最多 30 条，每条 1–500 字')
  if (![true, false, null].includes(input.noAnswer)) throw new Error('是否无答案须为 true、false 或 null（未知）')
  if (typeof input.referencesComplete !== 'boolean') throw new Error('须明确标准资料是否完整')
  if (input.noAnswer === true && input.references.some(ref => ref.grade > 0)) throw new Error('无答案问题不能包含相关标准资料')
  if (input.knowledgeId !== undefined && input.knowledgeId !== '' && (typeof input.knowledgeId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.knowledgeId))) throw new Error('知识库 ID 须为 1–128 位字母、数字、下划线或短横线；留空使用默认库')
  return {
    query: input.query.trim(), retrievalMode: input.retrievalMode || 'knowledge', knowledgeId: input.knowledgeId || '', category: String(input.category || '直接查询').slice(0, 50),
    corpusVersion: String(input.corpusVersion || '').slice(0, 100),
    noAnswer: input.noAnswer, referencesComplete: input.referencesComplete,
    references: input.references.map(({ id, grade }) => ({ id, grade })),
    evidencePoints: input.evidencePoints.map(point => point.trim())
  }
}

module.exports = { evidenceId, normalizeEvidence, evaluate, summarize, validateCase, assessment }
