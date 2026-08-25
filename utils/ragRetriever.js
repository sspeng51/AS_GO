/**
 * RAG 检索器 — 智谱托管知识库版
 *
 * 架构：
 * - 公共知识库走智谱托管（Rerank + 查询重写，质量更高），失败直接返回不可用结果
 * - 失败优雅降级（不阻塞对话）
 *
 * 配置：
 * - context/zhipu 两组配置由云函数 rag.config.get 下发，本地仅保留默认兜底
 */

// RAG 调优配置本地默认值（云函数配置拉取失败时兜底）
// 与云函数 getDefaultRagConfig 保持一致：仅 zhipu + context 两组
// P0-4: cloudTimeout 35s → 15s，避免 RAG 拖垮主回答 60s 预算
const DEFAULT_RAG_CONFIG = {
  zhipu: { useZhipuKb: true, topN: 15, cloudTimeout: 15000 },
  retrieval: { recallMethod: 'mixed', recallRatio: 80, rerankStatus: 0 },
  context: { maxChunks: 4, maxTokens: 2000, minScore: 40, overlap: 200, includeMetadata: true }
}

class RAGRetriever {
  constructor(options = {}) {
    this.topK = options.topK || 8
    // P0-4: 35s → 15s，与云函数端 zhipuClient 检索超时对齐
    this.cloudTimeout = options.cloudTimeout || 15000
    this.userId = options.userId || null
    this._ragConfig = null
  }

  // 拉取 RAG 调优配置（云函数 rag.config.get），缓存后复用；失败时用本地默认配置
  async _loadConfig() {
    if (this._ragConfig) return this._ragConfig
    try {
      const res = await new Promise((resolve, reject) => {
        wx.cloud.callFunction({
          name: 'processKnowledge',
          data: { action: 'rag.config.get', data: {} },
          success: resolve,
          fail: reject
        })
      })
      const cfg = res.result && res.result.config
      if (cfg && cfg.zhipu && cfg.context) {
        this._ragConfig = cfg
      } else {
        this._ragConfig = DEFAULT_RAG_CONFIG
      }
    } catch (e) {
      console.warn('[RAG] 加载RAG配置失败，使用默认配置:', (e && e.errMsg) || e)
      this._ragConfig = DEFAULT_RAG_CONFIG
    }
    return this._ragConfig
  }

  async retrieve(query, options = {}) {
    const startTime = Date.now()
    const cfg = await this._loadConfig()
    const topK = options.topK || cfg.zhipu.topN || this.topK
    console.log(`[RAG] 检索: "${query.substring(0, 50)}..."`)

    try {
      const result = await this._callZhipuKB(query, topK)
      if (result.isUnavailable) {
        console.warn(`[RAG] 智谱检索不可用: ${result.error}`)
        return result
      }
      const duration = Date.now() - startTime
      const mode = result.sourceInfo?.searchMode || 'unknown'
      console.log(`[RAG] ${result.matchQuality} [${mode}] ${duration}ms, ${result.chunks?.length || 0}个结果`)
      return result
    } catch (e) {
      console.error(`[RAG] 检索失败: ${e.message}`)
      return this._unavailableResult(e.message)
    }
  }

  // 智谱托管知识库检索（公共知识库专用）
  async _callZhipuKB(query, topK) {
    const cfg = await this._loadConfig()
    // 公共知识库目前只有智谱托管这一条检索链路。关闭时明确跳过检索，
    // 让调用方据此提示“通识回答”，而不是误报为知识库无匹配。
    if (cfg.zhipu.useZhipuKb === false) {
      return this._disabledResult()
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn('[RAG] 智谱知识库客户端超时')
        resolve(this._unavailableResult('智谱知识库检索超时'))
      }, cfg.zhipu.cloudTimeout)

      wx.cloud.callFunction({
        name: 'processKnowledge',
        data: {
          action: 'kb.zhipu.search',
          data: { query, topK: Math.max(topK, cfg.zhipu.topN), topN: cfg.zhipu.topN }
        },
        success: async (res) => {
          clearTimeout(timer)
          if (!res.result?.success) {
            // 返回结构化失败，交由 retrieve 直接返回不可用结果
            resolve(this._unavailableResult(res.result?.error || '智谱知识库无结果'))
            return
          }
          const rawResults = res.result.results || []
          const searchMode = res.result.searchMode || 'zhipu'

          const chunks = rawResults.map(r => ({
            id: r.id,
            title: r.title || r.documentTitle || '未知文档',
            content: r.content || '',
            score: (r.score || 0) / 100, // 云函数已统一成 0-100，这里归一化到 0-1
            source: r.source || '智谱知识库',
            documentId: r.documentId,
            chunkId: r.chunkId || r._id,
            searchMode: r.searchMode || searchMode,
            vectorSimilarity: r.vectorSimilarity || 0,
            textRelevance: r.textRelevance || 0
          }))

          const filtered = await this._adaptiveFilter({ chunks, searchMode })
          resolve({
            ...filtered,
            sourceInfo: {
              searchMode,
              totalFound: res.result.totalFound || rawResults.length,
              duration: res.result.duration || 0,
              coverage: res.result.coverage || {},
              degraded: Boolean(res.result.degraded),
              retrievalFallback: res.result.retrievalFallback || null
            },
            // 必须尊重阈值过滤结果；不能用“返回了任意片段”覆盖成命中。
            hasMatch: filtered.hasMatch,
            matchQuality: filtered.matchQuality
          })
        },
        fail: (err) => {
          clearTimeout(timer)
          // 不 reject，统一返回不可用结果
          resolve(this._unavailableResult(err.errMsg || '智谱知识库云函数调用失败'))
        }
      })
    })
  }

  async _adaptiveFilter(result) {
    const cfg = await this._loadConfig()
    const chunks = result.chunks || []
    const searchMode = result.searchMode || 'unknown'

    if (chunks.length === 0) {
      return { chunks: [], context: '', hasMatch: false, matchQuality: 'no_match' }
    }

    // 阈值来自 context.minScore（云函数侧为 0-100），chunks 的 score 已归一化到 0-1
    // 0 是合法配置，不能用 || 回退为 30，否则后台设置“不过滤”不会生效。
    const minScore = typeof cfg.context.minScore === 'number' ? cfg.context.minScore : 40
    const threshold = minScore / 100
    const maxChunks = typeof cfg.context.maxChunks === 'number' ? cfg.context.maxChunks : 4

    const passed = chunks.filter(c => c.score >= threshold)
    // 全部低于阈值时应明确判定为无匹配，不能强塞最高分片段污染回答。
    const finalChunks = passed.slice(0, maxChunks)

    return {
      chunks: finalChunks,
      context: this._buildContext(finalChunks, searchMode, cfg),
      hasMatch: finalChunks.length > 0,
      matchQuality: this._quality(finalChunks, searchMode)
    }
  }

  _buildContext(chunks, searchMode, cfg) {
    if (!chunks || chunks.length === 0) return ''

    // 去重：相同文档中内容相似度高的 chunk 只保留得分最高的
    const deduped = []
    const seenContent = new Set()
    for (const chunk of chunks) {
      const content = chunk.content || ''
      const head = content.substring(0, 80).trim()
      const tail = content.substring(Math.max(0, content.length - 50)).trim()
      const fingerprint = head + '|' + tail
      if (fingerprint && seenContent.has(fingerprint)) continue
      seenContent.add(fingerprint)
      deduped.push(chunk)
    }

    // 总字符预算 ≈ maxTokens * 4（粗略估算 1 token ≈ 4 字符）
    const contextTokens = typeof cfg.context.maxTokens === 'number' ? cfg.context.maxTokens : 2000
    const maxContextChars = contextTokens * 4
    const perChunkLimit = Math.floor(maxContextChars / Math.max(deduped.length, 1))
    let ctx = '【知识库参考内容】\n\n'
    let totalChars = 0

    for (let i = 0; i < deduped.length; i++) {
      const chunk = deduped[i]
      const modeLabel = chunk.searchMode === 'zhipu' ? '[智谱检索] ' : ''
      const truncated = (chunk.content || '').substring(0, perChunkLimit)

      if (totalChars + truncated.length > maxContextChars && i > 0) break
      totalChars += truncated.length

      ctx += `[来源${i + 1}] ${modeLabel}${chunk.title}\n${truncated}\n\n`
    }

    return ctx
  }

  _quality(chunks, searchMode) {
    if (!chunks || chunks.length === 0) return 'no_match'
    const top = chunks[0]?.score || 0
    if (top >= 0.55) return 'high'
    if (top >= 0.30) return 'medium'
    if (top >= 0.15) return 'low'
    if (top >= 0.05) return 'very_low'
    return 'minimal'
  }

  // 智谱知识库不可用时的结构化失败结果，retrieve 直接返回
  _unavailableResult(error) {
    return {
      chunks: [], context: '',
      sourceInfo: { searchMode: 'zhipu', error },
      hasMatch: false, matchQuality: 'error',
      isUnavailable: true, error
    }
  }

  _disabledResult() {
    return {
      chunks: [], context: '',
      sourceInfo: { searchMode: 'disabled', disabled: true },
      hasMatch: false, matchQuality: 'disabled',
      isDisabled: true
    }
  }

  getNoMatchPrefix() {
    return `【重要】知识库中未检索到与该问题直接相关的内容。请基于你的专业知识回答用户问题，并在回答开头明确说明"知识库中暂无该问题的直接相关内容，以下为基于专业知识的回答"。`
  }

  getRetrievalDisabledPrefix() {
    return `【重要】当前公共知识库检索已由管理员关闭。请基于你的专业知识回答用户问题，并在回答开头明确说明“当前未启用公共知识库检索，以下为基于专业知识的回答”。`
  }
}

module.exports = RAGRetriever
