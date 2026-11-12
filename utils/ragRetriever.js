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
const { calculateHybridTimeout } = require('./hybridTimeout')

const DEFAULT_RAG_CONFIG = {
  zhipu: { useZhipuKb: true, topN: 15, cloudTimeout: 15000 },
  retrieval: { recallMethod: 'mixed', recallRatio: 80, rerankStatus: 0 },
  context: { maxChunks: 10, maxTokens: 2000, minScore: 40, overlap: 200, includeMetadata: true },
  graph: { enabled: true, hybridTimeout: 85000, plannerTimeout: 12000, queryTimeout: 15000, maxHops: 2, maxFacts: 20, contextMaxTokens: 800, schemaCacheTTL: 600000 }
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
        this._ragConfig = {
          ...DEFAULT_RAG_CONFIG,
          ...cfg,
          zhipu: { ...DEFAULT_RAG_CONFIG.zhipu, ...cfg.zhipu },
          context: { ...DEFAULT_RAG_CONFIG.context, ...cfg.context },
          graph: { ...DEFAULT_RAG_CONFIG.graph, ...(cfg.graph || {}) }
        }
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
      const result = await this._callHybridSearch(query, topK)
      if (result.isUnavailable) {
        console.warn(`[RAG] 混合检索不可用: ${result.error}`)
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

  // 服务端顺序执行：智谱知识库 → 实体关系规划 → Neo4j → 证据融合
  async _callHybridSearch(query, topK) {
    const cfg = await this._loadConfig()
    const clientTimeout = calculateHybridTimeout(cfg)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`[RAG] 混合检索客户端超时 (${clientTimeout}ms)`)
        resolve(this._unavailableResult(`混合检索超时 (${clientTimeout}ms)`))
      }, clientTimeout)

      wx.cloud.callFunction({
        name: 'processKnowledge',
        data: {
          action: 'kb.hybrid.search',
          data: { query, topK: Math.max(topK, cfg.zhipu.topN) }
        },
        success: async (res) => {
          clearTimeout(timer)
          if (!res.result?.success) {
            // 返回结构化失败，交由 retrieve 直接返回不可用结果
            resolve(this._unavailableResult(res.result?.error || '混合检索失败'))
            return
          }
          const rawResults = res.result.evidences || []
          const graphDebug = res.result.sourceInfo?.neo4j?.debug || null
          if (graphDebug) {
            console.log('[RAG][Neo4j调试] 状态:', graphDebug.status)
            console.log('[RAG][Neo4j调试] 规划模型:', graphDebug.plannerModel || '未完成规划')
            console.log('[RAG][Neo4j调试] 模型尝试:', graphDebug.plannerAttempts || [])
            console.log('[RAG][Neo4j调试] 实体:', graphDebug.entities || [])
            console.log('[RAG][Neo4j调试] 实体类型:', graphDebug.entityTypes || [])
            console.log('[RAG][Neo4j调试] 关系:', graphDebug.relations || [])
            console.log('[RAG][Neo4j调试] Cypher:', graphDebug.cypher || '未生成 Cypher')
            console.log('[RAG][Neo4j调试] Cypher 来源:', graphDebug.cypherSource || '未生成')
            if (graphDebug.recoveryReason) console.warn('[RAG][Neo4j调试] 查询回退原因:', graphDebug.recoveryReason)
            console.log('[RAG][Neo4j调试] 参数:', graphDebug.params || {})
            console.log('[RAG][Neo4j调试] 返回记录/事实:', graphDebug.recordCount || 0, '/', res.result.sourceInfo?.neo4j?.count || 0)
            if (graphDebug.error) console.warn('[RAG][Neo4j调试] 错误:', graphDebug.error)
          }
          const chunks = rawResults.map(r => ({
            id: r.id,
            title: r.title || r.documentTitle || '未知文档',
            content: r.content || '',
            score: r.sourceType === 'neo4j' ? null : (r.score || 0),
            source: r.source || (r.sourceType === 'neo4j' ? 'Neo4j 知识图谱' : '智谱知识库'),
            sourceType: r.sourceType || 'zhipu',
            documentId: r.documentId,
            chunkId: r.chunkId || r._id,
            searchMode: r.searchMode || (r.sourceType === 'neo4j' ? 'neo4j' : 'zhipu'),
            vectorSimilarity: r.vectorSimilarity || 0,
            textRelevance: r.textRelevance || 0,
            nodes: r.nodes || [],
            relation: r.relation || ''
          }))
          resolve({
            chunks,
            context: res.result.context || '',
            expertGuidance: res.result.expertGuidance || null,
            sourceInfo: res.result.sourceInfo || {},
            graphDebug,
            hasMatch: Boolean(res.result.hasMatch),
            matchQuality: res.result.matchQuality || 'no_match'
          })
        },
        fail: (err) => {
          clearTimeout(timer)
          // 不 reject，统一返回不可用结果
          resolve(this._unavailableResult(err.errMsg || '混合检索云函数调用失败'))
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
    const maxChunks = typeof cfg.context.maxChunks === 'number' ? cfg.context.maxChunks : 10

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
      sourceInfo: { searchMode: 'hybrid', error, degraded: true },
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
    return `【重要】知识库与知识图谱中均未检索到与该问题直接相关的内容。请基于专业知识回答，并在开头明确说明“现有知识库与图谱中暂无直接相关证据，以下为基于专业知识的回答”。`
  }

  getRetrievalUnavailablePrefix() {
    return '【重要】本轮知识库或图谱检索未能完整完成，且没有可用片段。请明确说明“本轮检索未完整完成，暂无法核实相关证据”，不要声称知识库中不存在资料。仅提供有边界的一般解释，不编造参数、企业事实或合规结论。'
  }

  getRetrievalDisabledPrefix() {
    return `【重要】当前公共知识库检索已由管理员关闭。请基于你的专业知识回答用户问题，并在回答开头明确说明“当前未启用公共知识库检索，以下为基于专业知识的回答”。`
  }
}

module.exports = RAGRetriever
