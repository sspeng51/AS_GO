const { evaluate } = require('./ragEvaluation')

function reviewQueueEntry(run) {
  const metrics = evaluate(run)
  const results = run.results || []
  const judge = run.judge
  const points = run.testCase?.evidencePoints || []
  const aiGrades = new Map((judge?.grades || []).map(item => [item.id, item.grade]))
  const hasJudge = results.length > 0 && results.every(item => [0, 1, 2].includes(aiGrades.get(item.evaluationId)))
  const aiScore = hasJudge ? results.reduce((sum, item) => sum + aiGrades.get(item.evaluationId), 0) / (2 * results.length) : null
  const aiEvidenceCoverage = hasJudge && points.length && Array.isArray(judge.coverage)
    ? new Set(judge.coverage.map(item => item.point).filter(index => Number.isInteger(index) && index >= 0 && index < points.length)).size / points.length : null
  const review = run.review
  const currentReview = review && (!judge || (judge.id ? review.judgeId === judge.id : Date.parse(review.reviewedAt) >= Date.parse(judge.createdAt)))
  const reviewed = currentReview && results.every(item => [0, 1, 2].includes(review.grades?.[item.evaluationId])) && (!points.length || Array.isArray(review.coveredPoints))
  const attempt = run.judgeAttempt || {}
  const running = attempt.status === 'running' && Date.now() - Date.parse(attempt.startedAt) < 270000
  const interrupted = attempt.status === 'running' && !running
  let status = !metrics.eligible ? 'blocked' : reviewed ? 'reviewed' : running ? 'running'
    : attempt.status === 'failed' || interrupted ? 'failed' : hasJudge ? 'pending' : results.length ? 'unjudged' : 'empty'
  const reasons = []
  if (hasJudge) {
    if (aiScore < 0.6) reasons.push('初评分低于 60%')
    if (!results.some(item => aiGrades.get(item.evaluationId) === 2)) reasons.push('缺少直接支撑证据')
    if (aiEvidenceCoverage !== null && aiEvidenceCoverage < 1) reasons.push('证据点未覆盖完整')
    if (judge.truncated) reasons.push('初评资料被截断')
    const gold = new Map((run.testCase?.references || []).map(item => [item.id, item.grade]))
    if (results.some(item => gold.has(item.evaluationId) && gold.get(item.evaluationId) !== aiGrades.get(item.evaluationId))) reasons.push('与已有标准存在分歧')
  }
  if (status === 'empty') reasons.push('空结果需人工确认')
  if (status === 'failed') reasons.push('初评失败，待重试')
  return {
    _id: run._id, query: run.query, batchId: run.batchId || '', createdAt: run.createdAt,
    knowledgeId: run.knowledgeBase?.id || run.requestedKnowledgeId || '', retrievalMode: run.retrievalMode || 'hybrid',
    status, reasons, priority: reasons.length > 0 && status !== 'reviewed',
    canJudge: metrics.eligible && results.length > 0 && !['running', 'reviewed'].includes(status),
    aiScore, aiEvidenceCoverage, hasJudge, judgeModel: judge?.model || '',
    judgeAt: judge?.createdAt || '', attemptError: interrupted ? '上次初评中断或超时，可重试' : attempt.error || '',
    sufficiency: judge?.sufficiency || '', reviewer: review?.reviewer || '', metrics
  }
}

module.exports = { reviewQueueEntry }
