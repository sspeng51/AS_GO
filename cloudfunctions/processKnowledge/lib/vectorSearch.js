/**
 * 向量检索（内存余弦相似度）
 *
 * 适用场景：个人知识库 —— 按 userId 过滤后的有限切片集
 * 不适用：跨用户大规模检索（需 ANN 或专用向量数据库，留待 Phase 3）
 *
 * 性能权衡：
 * - 单用户切片量通常 < 500，O(n*d) 余弦计算 < 50ms
 * - 1024 维向量在 JSON 中约 10KB/条，500 条约 5MB 传输
 *   （Phase 3 可改用 512 维或二进制打包优化）
 */

/**
 * 余弦相似度
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} 0-1 区间相似度
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i]
    const bv = b[i]
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * 从候选切片中检索最相关的 topK
 * @param {number[]} queryVec 查询向量
 * @param {Array<{_id, docId, docName, chunkIndex, text, embedding}>} candidates 候选切片
 * @param {number} topK 返回条数
 * @param {number} minScore 最低相似度阈值（0-1），低于则不返回
 * @returns {Array<{chunkId, docId, docName, chunkIndex, text, score}>}
 */
function search(queryVec, candidates, topK = 5, minScore = 0) {
  const scored = (candidates || [])
    .filter(c => c && Array.isArray(c.embedding) && c.embedding.length > 0)
    .map(c => ({
      chunkId: c._id,
      docId: c.docId,
      docName: c.docName || '',
      chunkIndex: c.chunkIndex || 0,
      text: c.text || '',
      score: cosineSimilarity(queryVec, c.embedding)
    }))

  scored.sort((a, b) => b.score - a.score)

  const result = minScore > 0 ? scored.filter(s => s.score >= minScore) : scored
  return result.slice(0, topK)
}

module.exports = { cosineSimilarity, search }
