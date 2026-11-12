export const answerGroups = { A: 'A 直接回答', B: 'B 文档 RAG', C: 'C 文档＋图谱', D: 'D 文档＋专家规范', E: 'E 文档＋图谱＋专家规范' }
export const answerMetrics = { professionalCorrectness: '专业准确性', conditionApplicability: '工况适配性', citationSupport: '引用支撑质量', supportedConclusions: '结论依据充分性', answerCoverage: '回答完整性' }
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
export function answerReport(experiments, paired = true) {
  // A cohort must use one model pair, knowledge base and immutable generation settings.
  const cohorts = new Map()
  for (const run of experiments) {
    const key = JSON.stringify([run.knowledgeId, run.k, run.generation, run.judgeModel, run.protocol || 'legacy', run.judgeProtocol || 'legacy', run.evaluationScope || (run.graph ? 'documents_graph' : 'documents_only'), run.scoringVersion || 'legacy'])
    if (!cohorts.has(key)) cohorts.set(key, [])
    cohorts.get(key).push(run)
  }
  return [...cohorts.entries()].flatMap(([cohort, runs]) => Object.entries(answerGroups).map(([group, label]) => {
    const eligible = runs.filter(run => !paired || Object.keys(answerGroups).every(key => run.variants[key]?.judge && run.variants[key]?.finishReason !== 'length'))
    const metrics = Object.fromEntries(Object.keys(answerMetrics).map(key => {
      const values = eligible.filter(run => (!paired || Object.keys(answerGroups).every(groupKey => Number.isFinite(metricFor(run.variants[groupKey], key)?.value))) && run.variants[group]?.finishReason !== 'length').map(run => metricFor(run.variants[group], key)?.value).filter(Number.isFinite)
      return [key, { value: mean(values), samples: values.length }]
    }))
    const calls = runs.flatMap(run => run.calls.filter(call => call.stage === `generate:${group}` || call.stage === `judge:${group}`))
    const generationTimes = runs.map(run => run.variants[group]?.timings?.totalMs).filter(Number.isFinite)
    const judging = runs.flatMap(run => run.calls.filter(call => call.stage === `judge:${group}` || (call.stage === 'judge:batch' && call.groups?.includes(group))))
    return { key: `${cohort}:${group}`, group, label, cohort, scoringVersion: runs[0].scoringVersion, knowledgeLabel: knowledgeLabel(runs[0]), configLabel: `${runs[0].generation?.model || '—'} → ${runs[0].judgeModel || '—'}`, count: runs.length, evaluated: eligible.filter(run => run.variants[group]?.judge).length, metrics,
      generationMs: mean(generationTimes), timingSamples: generationTimes.length, judgeMs: mean(judging.map(call => call.latencyMs).filter(Number.isFinite)),
      calls: calls.length, tokens: calls.length && calls.every(call => Number.isFinite(call.usage?.total_tokens)) ? calls.reduce((sum, call) => sum + call.usage.total_tokens, 0) : null,
 }
  }))
}

export function tokenTotals(calls) {
  const known = calls.filter(call => Number.isFinite(call.usage?.total_tokens))
  const knownTokens = known.reduce((sum, call) => sum + call.usage.total_tokens, 0)
  return { tokens: known.length === calls.length ? knownTokens : null, knownTokens, missingUsage: calls.length - known.length }
}
export function answerTable(experiments, paired = true) {
  const rows = answerReport(experiments, paired).map(row => {
    const calls = experiments.filter(run => JSON.stringify([run.knowledgeId, run.k, run.generation, run.judgeModel, run.protocol || 'legacy', run.judgeProtocol || 'legacy', run.evaluationScope || (run.graph ? 'documents_graph' : 'documents_only'), run.scoringVersion || 'legacy']) === row.cohort).flatMap(run => run.calls.filter(call => call.stage === `generate:${row.group}` || call.stage === `judge:${row.group}`))
    return { ...row, ...tokenTotals(calls) }
  })
  const shared = experiments.flatMap(run => run.calls.filter(call => call.stage === 'rubric' || call.stage === 'judge:batch'))
  rows.push({ key: 'shared', label: '共享标准制定与集中评审', shared: true, ...tokenTotals(shared), metrics: Object.fromEntries(Object.keys(answerMetrics).map(key => [key, { value: null, samples: 0 }])) })
  return rows
}

export function knowledgeLabel(run) {
  return run.knowledgeBase?.name ? `${run.knowledgeBase.name}（${run.knowledgeBase.id || run.knowledgeId || '默认库'}）` : run.knowledgeBase?.id || run.knowledgeId || '默认知识库'
}
export function metricFormat(value, key, version) {
  if (!Number.isFinite(value)) return '—'
  if (version === 'analytic-100-v2') return `${(value * 100).toFixed(1)} / 100分`
  return version === 'anchored-v1' && ['professionalCorrectness','conditionApplicability'].includes(key) ? `${(value * 4).toFixed(2)} / 4分` : `${(value * 100).toFixed(1)}%`
}
export function questionAnalysis(experiments) {
  const report = answerReport(experiments, false), cohorts = [...new Set(report.map(row => row.cohort))]
  return cohorts.map(cohort => {
    const rows = report.filter(row => row.cohort === cohort)
    const runs = experiments.filter(run => answerReport([run], false)[0]?.cohort === cohort)
    const questions = runs.map((run, index) => ({ id: run._id, query: run.query, number: index + 1, variants: run.variants }))
    return { cohort, label: rows[0].knowledgeLabel, configLabel: rows[0].configLabel, version: rows[0].scoringVersion, questions,
      rows: rows.map(row => ({ ...row, questionMetrics: runs.map(run => run.variants[row.group]?.finishReason === 'length' ? {} : Object.fromEntries(Object.keys(answerMetrics).map(key => [key, metricFor(run.variants[row.group], key)]))) })) }
  })
}

export function metricFor(variant, key) {
  const metrics = variant?.judge?.metrics || {}
  if (key !== 'supportedConclusions' || metrics[key]) return metrics[key]
  const old = metrics.unsupportedConclusions
  if (!old) return undefined
  return { ...old, value: Number.isFinite(old.value) ? 1 - old.value : null, numerator: Number.isFinite(old.denominator) && Number.isFinite(old.numerator) ? old.denominator - old.numerator : undefined }
}
