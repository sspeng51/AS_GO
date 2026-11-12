export function quickMetrics(run, basis = 'preferred') {
  const formal = run.metrics || {}
  const grades = new Map((run.judge?.grades || []).map(item => [item.id, item.grade]))
  const values = (run.results || []).map(item => grades.get(item.evaluationId))
  const fineScores = (run.results || []).map(item => run.judge?.grades?.find(g=>g.id===item.evaluationId)?.relevanceScore)
  const fine = fineScores.length && fineScores.every(Number.isFinite)
  const ready = formal.eligible && basis !== 'confirmed' && Number.isInteger(run.k) && run.k > 0 && values.length > 0 && values.every(value => [0, 1, 2].includes(value))
  const first = values.findIndex(value => value > 0)
  const points = run.testCase?.evidencePoints || []
  const pool = run.judge?.referencePool?.grades
  const poolReady = Array.isArray(pool) && pool.length > 0 && (run.results || []).every(item => pool.some(entry => entry.id === item.evaluationId))
  const relevantPool = poolReady ? pool.filter(item => item.grade > 0).length : 0
  const dcg = list => list.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0)
  const ideal = poolReady ? dcg(pool.map(item => item.grade).sort((a, b) => b - a).slice(0, run.k)) : 0
  const emptyRank = !values.length && formal.eligible && Number.isInteger(run.k) && run.k > 0
  const value = (key, estimated, missing) => !formal.eligible ? { value: null, basis: '检索异常，不计分' } : basis !== 'model' && Number.isFinite(formal[key])
    ? { value: formal[key], basis: '已确认' }
    : emptyRank && ['precisionAtK', 'mrr', 'hitRate'].includes(key) ? { value: 0, basis: '空结果，无命中' }
    : { value: ready && Number.isFinite(estimated) ? estimated : null, basis: ready && Number.isFinite(estimated) ? '模型估算' : basis === 'confirmed' ? '尚未人工确认' : run.autoError || run.judgeAttempt?.status === 'failed' ? '模型评估失败，可重试' : !values.length ? '空结果，需确认答案性' : missing }
  return {
    evidenceUtility: value('evidenceUtility', fine ? fineScores.reduce((a,b)=>a+b,0)/(100*run.k) : null, '需百分制相关性评分'),
    precisionAtK: value('precisionAtK', values.filter(v => v > 0).length / run.k, '等待初评'),
    mrr: value('mrr', first < 0 ? 0 : 1 / (first + 1), '等待初评'),
    hitRate: value('hitRate', Number(first >= 0), '等待初评'),
    contextRelevance: value('contextRelevance', fine ? fineScores.reduce((a,b)=>a+b,0)/(100*fineScores.length) : values.reduce((sum, grade) => sum + grade, 0) / (2 * values.length), '等待相关性评分'),
    evidenceCoverage: value('evidenceCoverage', points.length && Array.isArray(run.judge?.coverage) ? new Set(run.judge.coverage.map(item => item.point).filter(point => Number.isInteger(point) && point >= 0 && point < points.length)).size / points.length : null, '缺少证据点'),
    recallAtK: { ...value('recallAtK', relevantPool ? values.filter(grade => grade > 0).length / relevantPool : null, '需完整标准或生成候选池标准'), ...(ready && relevantPool && (basis === 'model' || (basis !== 'confirmed' && !Number.isFinite(formal.recallAtK))) ? { basis: '模型候选池估算' } : {}) },
    ndcgAtK: { ...value('ndcgAtK', ideal ? dcg(values) / ideal : null, '需完整标准或生成候选池标准'), ...(ready && ideal && (basis === 'model' || (basis !== 'confirmed' && !Number.isFinite(formal.ndcgAtK))) ? { basis: '模型候选池估算' } : {}) },
    noAnswerCorrect: value('noAnswerCorrect', null, '需确认库内是否有答案'),
    falseRecall: value('falseRecall', null, '需无答案测试标准')
  }
}

export function runState(run) {
  if (run.queued) return {key:'queued',label:'待检索（可续跑）',type:'info'}
  if (run.loading) return { key: 'loading', label: '读取中', type: 'info' }
  if (run.loadError) return { key: 'loadFailed', label: '记录读取失败', type: 'danger' }
  if (!run.metrics?.eligible) return { key: 'retrievalFailed', label: '检索异常', type: 'danger' }
  if (!run.results?.length) return { key: 'empty', label: '未找到证据', type: 'warning' }
  if (run.judgeAttempt?.status === 'running' && Date.now() - Date.parse(run.judgeAttempt.startedAt) < 270000) return { key: 'running', label: '模型评估中', type: 'info' }
  if (run.autoError || run.judgeAttempt?.status === 'failed') return { key: 'judgeFailed', label: '模型评估失败', type: 'danger' }
  if (Number.isFinite(quickMetrics(run, 'model').precisionAtK.value)) return { key: 'complete', label: '评估完成', type: 'success' }
  return { key: 'pending', label: '待模型评估', type: 'info' }
}

export function buildReport(rows, names, rerankNames, basis = 'model', paired = false) {
  const groups = new Map()
  const modelNames = [...new Set(rows.map(run => run.judge?.model).filter(Boolean))]
  const versions = [...new Set(rows.map(r=>r.judge?.version).filter(Boolean))]
  const onlyVersion = versions.length===1?versions[0]:'unscored'
  const onlyModel = modelNames.length === 1 ? modelNames[0] : '尚未初评'
  const libraryNames = new Map(rows.filter(run => run.knowledgeBase?.name).map(run => [run.knowledgeBase.id, run.knowledgeBase.name]))
  for (const run of rows) {
    const target = run.knowledgeBase?.id || run.targetId || run.requestedKnowledgeId || '默认知识库'
    const rerank = rerankNames[run.metrics?.rerankMode] || '未记录重排'
    const model = basis === 'model' ? run.judge?.model || onlyModel : ''
    const key = JSON.stringify([target, run.k, run.metrics?.rerankMode || 'unknown', model, basis === 'confirmed' ? 'confirmed' : run.judge?.version || onlyVersion])
    const cohort = JSON.stringify([run.k, run.metrics?.rerankMode || 'unknown', model, basis === 'confirmed' ? 'confirmed' : run.judge?.version || onlyVersion])
    const name = libraryNames.get(target) || target
    const duplicateName = [...libraryNames].some(([id, value]) => id !== target && value === name)
    const label = `${name}${duplicateName ? `（${target}）` : ''} · ${rerank} · K=${run.k ?? '?'}${model ? ` · ${model}` : ''}${run.judge?.version ? ` · ${run.judge.version === 'retrieval-judge-v5' ? '分项百分制' : run.judge.version === 'retrieval-judge-v4' ? '细评分' : '等级评分'}` : ''}`
    if (!groups.has(key)) groups.set(key, { key, cohort, label, knowledgeId: target, knowledgeName: libraryNames.get(target) || '', runs: [] })
    groups.get(key).runs.push(run)
  }
  // Deduplicate repeated questions within each group; comparisons use the latest run.
  const normalized = [...groups.values()].map(group => ({ ...group, runs: [...new Map(group.runs.map(run => [run.query, run])).values()] }))
  const commonFor = group => {
    const peers=normalized.filter(g=>g.cohort===group.cohort)
    return Object.fromEntries(Object.keys(names).map(key=>{
      const identity=run=>JSON.stringify([run.query,run.k,key==='evidenceCoverage'?run.testCase?.evidencePoints||[]:''])
      const sets=peers.map(g=>new Set(g.runs.filter(r=>Number.isFinite(quickMetrics(r,basis)[key].value)).map(identity)))
      return [key,{identity,ids:new Set(sets.length?[...sets[0]].filter(id=>sets.every(set=>set.has(id))):[])}]
    }))
  }
  return normalized.map(group => {
    const {key:groupKey,label,knowledgeId,knowledgeName,runs}=group
    const common=commonFor(group)
    const latencies = runs.filter(run => run.metrics?.eligible && Number.isFinite(run.latencyMs)).map(run => run.latencyMs)
    const avg = key => {
      const data = runs.filter(run => !paired || common[key].ids.has(common[key].identity(run))).map(run => quickMetrics(run, basis)[key]).filter(item => Number.isFinite(item.value))
      const reasons = [...new Set(runs.map(run => quickMetrics(run, basis)[key]).filter(item => item.value === null).map(item => item.basis))]
      return { value: data.length ? data.reduce((sum, item) => sum + item.value, 0) / data.length : null, samples: data.length, basis: data.length ? [...new Set(data.map(item => item.basis))].join(' / ') : paired ? '无共同有效样本' : reasons.join('；') }
    }
    const questions = runs.map(run => ({ query: run.query, metrics: Object.fromEntries(Object.keys(names).map(key => [key,
      paired && !common[key].ids.has(common[key].identity(run)) ? { value: null, basis: '非共同有效问题' } : quickMetrics(run, basis)[key]
    ])) }))
    return { key: groupKey, label, knowledgeId, knowledgeName, questions, count: runs.length, failures: runs.filter(run => !run.metrics?.eligible).length, judgeFailures: runs.filter(run => runState(run).key === 'judgeFailed').length,
      latency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null, metrics: Object.fromEntries(Object.keys(names).map(key => [key, avg(key)])) }
  })
}
