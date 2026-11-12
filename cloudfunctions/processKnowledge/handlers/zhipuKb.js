/**
 * 智谱托管知识库 handler（公共知识库，只读）
 *
 * actions:
 *   - kb.zhipu.search           检索（核心 RAG 入口，走智谱 Rerank + 查询重写）
 *   - kb.zhipu.documents        文档列表（分页）
 *   - kb.zhipu.document.detail  文档详情
 *   - kb.zhipu.document.read    文档阅读（详情 + retrieval 拼接正文）
 *   - kb.zhipu.info             知识库概览统计
 */

const config = require('../config')
const {
  callZhipuKBRetrieval,
  callZhipuKBGet,
  adaptZhipuResultToRagFormat,
  adaptZhipuDocument,
  normalizeScore
} = require('../lib/zhipuClient')

// ============ 智谱托管知识库检索（公共知识库走智谱，享受 Rerank + 查询重写） ============

async function handleZhipuKBSearch(data, context, configSnapshot, knowledgeIdOverride) {
  const { query, queries, topK = 10 } = data || {}

  if (!query || !query.trim()) {
    return { success: false, error: '搜索查询不能为空' }
  }

  const apiKey = config.zhipu.apiKey
  const knowledgeId = knowledgeIdOverride || config.zhipu.knowledgeId
  if (!apiKey) {
    return { success: false, error: '云函数未配置 ZHIPU_API_KEY 或 BIGMODEL_API_KEY 环境变量' }
  }
  if (!knowledgeId) {
    return { success: false, error: '云函数未配置 ZHIPU_KNOWLEDGE_ID 环境变量（智谱托管知识库 ID）' }
  }

  const cleanQuery = query.trim()
  // 官方 retrieval API 将 query 限制为 1000 字；在云函数侧再次校验，防止
  // 其他调用方绕过小程序限制并收到难以定位的上游业务 500。
  if (cleanQuery.length > 1000) {
    return { success: false, error: '搜索查询不能超过 1000 字' }
  }
  const useTopK = Math.min(Math.max(topK, 5), 20)
  const searchStart = Date.now()

  try {
    const queryList = [...new Set((Array.isArray(queries) ? queries : [cleanQuery])
      .map(item => String(item || '').trim()).filter(Boolean))].slice(0, 2)
    const settled = await Promise.allSettled(queryList.map(searchQuery => callZhipuKBRetrieval({
      knowledgeId,
      query: searchQuery.substring(0, 1000),
      topK: useTopK,
      ragConfig: configSnapshot,
      apiKey
    })))
    const successful = settled
      .map((item, index) => item.status === 'fulfilled'
        ? adaptZhipuResultToRagFormat(item.value, 0).results.map(result => ({ ...result, matchedQuery: queryList[index] }))
        : [])
      .flat()
    if (!successful.length && settled.some(item => item.status === 'rejected')) {
      throw settled.find(item => item.status === 'rejected').reason
    }
    const byChunk = new Map()
    for (const item of successful) {
      const key = item.id || `${item.documentId || item.title}|${String(item.content || '').slice(0, 160)}`
      const previous = byChunk.get(key)
      if (!previous || Number(item.score) > Number(previous.score)) byChunk.set(key, item)
    }
    const duration = Date.now() - searchStart
    const adapted = {
      success: true,
      results: [...byChunk.values()].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, useTopK),
      duration,
      queryVariants: queryList,
      degraded: settled.some(item => item.status === 'fulfilled' && item.value.retrievalFallback),
      retrievalFallbacks: settled.filter(item => item.status === 'fulfilled' && item.value.retrievalFallback).map(item => item.value.retrievalFallback),
      partialFailure: settled.some(item => item.status === 'rejected')
    }

    console.log(`[ZhipuKB] 双语检索完成 ${duration}ms, ${queryList.length} 个查询, 召回 ${adapted.results.length} 条`)
    return adapted
  } catch (e) {
    const duration = Date.now() - searchStart
    console.error(`[ZhipuKB] 检索失败 ${duration}ms:`, e.message)
    // 失败返回结构化错误，前端可据此降级到自建 RAG
    return {
      success: false,
      error: e.message || '智谱知识库检索失败',
      isUnavailable: true,
      duration
    }
  }
}

// 文档列表（分页）
async function handleZhipuKBDocumentList(data, context) {
  const { page = 1, size = 10, word = '' } = data || {}

  const apiKey = config.zhipu.apiKey
  const knowledgeId = config.zhipu.knowledgeId
  if (!apiKey) {
    return { success: false, error: '云函数未配置 ZHIPU_API_KEY' }
  }
  if (!knowledgeId) {
    return { success: false, error: '云函数未配置 ZHIPU_KNOWLEDGE_ID' }
  }

  try {
    let query = `?knowledge_id=${encodeURIComponent(knowledgeId)}&page=${page}&size=${size}`
    if (word) query += `&word=${encodeURIComponent(word)}`

    const res = await callZhipuKBGet(`/document${query}`, apiKey)
    const list = (res.data && res.data.list) || []
    const total = (res.data && res.data.total) || 0

    const documents = list.map(adaptZhipuDocument)

    return {
      success: true,
      documents,
      total,
      page: Number(page),
      size: Number(size),
      hasMore: page * size < total
    }
  } catch (e) {
    console.error('[ZhipuKB] 文档列表失败:', e.message)
    return { success: false, error: e.message || '获取文档列表失败', documents: [], total: 0 }
  }
}

// 文档详情
async function handleZhipuKBDocumentDetail(data, context) {
  const { documentId } = data || {}

  if (!documentId) {
    return { success: false, error: 'documentId 不能为空' }
  }

  const apiKey = config.zhipu.apiKey
  if (!apiKey) {
    return { success: false, error: '云函数未配置 ZHIPU_API_KEY' }
  }

  try {
    const res = await callZhipuKBGet(`/document/${encodeURIComponent(documentId)}`, apiKey)
    const doc = res.data
    if (!doc) {
      return { success: false, error: '文档不存在或已删除' }
    }

    return {
      success: true,
      document: adaptZhipuDocument(doc)
    }
  } catch (e) {
    console.error('[ZhipuKB] 文档详情失败:', e.message)
    return { success: false, error: e.message || '获取文档详情失败' }
  }
}

// 知识库概览统计
async function handleZhipuKBInfo(data, context) {
  const apiKey = config.zhipu.apiKey
  const knowledgeId = config.zhipu.knowledgeId
  if (!apiKey) {
    return { success: false, error: '云函数未配置 ZHIPU_API_KEY' }
  }
  if (!knowledgeId) {
    return { success: false, error: '云函数未配置 ZHIPU_KNOWLEDGE_ID' }
  }

  try {
    // 调用知识库详情接口获取统计
    const res = await callZhipuKBGet(`/knowledge/${encodeURIComponent(knowledgeId)}`, apiKey)
    const info = res.data || {}

    return {
      success: true,
      info: {
        id: info.id || knowledgeId,
        name: info.name || '智谱知识库',
        description: info.description || '',
        icon: info.icon || '',
        background: info.background || '',
        documentSize: info.document_size || 0,
        wordNum: info.word_num || 0,
        length: info.length || 0,
        contextual: info.contextual || 0
      }
    }
  } catch (e) {
    console.error('[ZhipuKB] 知识库详情失败:', e.message)
    return { success: false, error: e.message || '获取知识库信息失败' }
  }
}

// 文档阅读：详情 + retrieval 拼接正文
// 智谱 /document/{id} 接口只返回元数据，不返回正文。
// 这里用文档名作为 query 调用 retrieval，过滤出属于该文档的切片，按 score 拼接为可读正文。
async function handleZhipuKBDocumentRead(data, context) {
  const { documentId, documentName } = data || {}

  if (!documentId) {
    return { success: false, error: 'documentId 不能为空' }
  }

  const apiKey = config.zhipu.apiKey
  const knowledgeId = config.zhipu.knowledgeId
  if (!apiKey) {
    return { success: false, error: '云函数未配置 ZHIPU_API_KEY' }
  }
  if (!knowledgeId) {
    return { success: false, error: '云函数未配置 ZHIPU_KNOWLEDGE_ID' }
  }

  const useQuery = (documentName && documentName.trim()) || documentId

  try {
    // 并行：拿文档元数据 + 用文档名检索相关切片
    const [detailRes, retrievalRes] = await Promise.all([
      callZhipuKBGet(`/document/${encodeURIComponent(documentId)}`, apiKey).catch(err => {
        console.warn('[ZhipuKB.read] 文档详情失败，继续使用 retrieval 结果:', err.message)
        return null
      }),
      callZhipuKBRetrieval({
        knowledgeId,
        query: useQuery,
        topK: 20,
        apiKey
      }).catch(err => {
        console.warn('[ZhipuKB.read] retrieval 失败:', err.message)
        return null
      })
    ])

    // 文档元数据
    let doc = null
    if (detailRes && detailRes.data) {
      doc = adaptZhipuDocument(detailRes.data)
    } else {
      // 回退：用入参构造最小元数据
      doc = {
        id: documentId,
        name: documentName || '未命名文档',
        url: '',
        knowledgeType: '未知',
        sentenceSize: 0,
        length: 0,
        wordNum: 0,
        embeddingStat: '未知',
        embeddingStatRaw: -1,
        embeddingReady: false,
        failInfo: null
      }
    }

    // 过滤属于当前文档的切片（retrieval 是混合召回，可能包含其他文档的切片）
    const allSlices = (retrievalRes && retrievalRes.data) || []
    const ownSlices = allSlices.filter(s => {
      const meta = (s && s.metadata) || {}
      // 智谱 metadata 中 doc_id 才是文档 ID，_id 是切片 ID
      return meta.doc_id === documentId || meta.doc_id === String(documentId)
    })

    // 拼接正文：按 score 降序（API 已保证），用 \n\n 分隔
    const content = ownSlices
      .map(s => (s && s.text) || '')
      .filter(t => t.trim())
      .join('\n\n')

    return {
      success: true,
      document: doc,
      content,
      slices: ownSlices.map((s, i) => ({
        id: (s.metadata && s.metadata._id) || `slice_${i}`,
        text: s.text || '',
        score: normalizeScore(s.score)
      })),
      sliceCount: ownSlices.length,
      // 提示前端：是否为过滤后的结果（若 retrieval 没召回任何属于本文档的切片，建议降级展示）
      fromRetrieval: true
    }
  } catch (e) {
    console.error('[ZhipuKB] 文档阅读失败:', e.message)
    return { success: false, error: e.message || '获取文档内容失败' }
  }
}

module.exports = {
  handleZhipuKBSearch,
  handleZhipuKBDocumentList,
  handleZhipuKBDocumentDetail,
  handleZhipuKBDocumentRead,
  handleZhipuKBInfo
}
