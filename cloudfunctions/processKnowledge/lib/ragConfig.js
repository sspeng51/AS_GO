/**
 * RAG 调优配置（从 rag_config 集合读取，5 分钟缓存）
 *
 * - 配置由管理后台写入 rag_config/current 文档
 * - 云函数侧仅读，5 分钟 TTL 缓存降低 DB 压力
 * - 失败时回退内置默认值，不阻塞业务
 */

const { db } = require('./db')

function getDefaultRagConfig() {
  return {
    // P0-4: cloudTimeout 35s → 15s，避免 RAG 拖垮主回答 60s 预算
    zhipu: { useZhipuKb: true, topN: 15, cloudTimeout: 15000 },
    retrieval: { recallMethod: 'mixed', recallRatio: 80, rerankStatus: 0 },
    context: { maxChunks: 4, maxTokens: 2000, minScore: 40, overlap: 200, includeMetadata: true }
  }
}

let _ragConfigCache = null
let _ragConfigCacheTime = 0
const RAG_CONFIG_TTL = 5 * 60 * 1000  // 5 分钟缓存

async function getRagConfig() {
  const now = Date.now()
  if (_ragConfigCache && (now - _ragConfigCacheTime) < RAG_CONFIG_TTL) {
    return _ragConfigCache
  }
  try {
    const res = await db.collection('rag_config').doc('current').get()
    const cfg = res && res.data
    if (cfg && cfg.zhipu) {
      // 兼容老配置：补全缺失字段
      const defaults = getDefaultRagConfig()
      _ragConfigCache = {
        zhipu: { ...defaults.zhipu, ...(cfg.zhipu || {}) },
        retrieval: { ...defaults.retrieval, ...(cfg.retrieval || {}) },
        context: { ...defaults.context, ...(cfg.context || {}) }
      }
      _ragConfigCacheTime = now
      return _ragConfigCache
    }
    console.warn('[RagConfig] rag_config 文档结构不完整，回退默认值')
  } catch (e) {
    console.warn('[RagConfig] 读取 rag_config 失败，回退默认值:', e.message)
  }
  const fallback = getDefaultRagConfig()
  _ragConfigCache = fallback
  _ragConfigCacheTime = now
  return fallback
}

module.exports = {
  getDefaultRagConfig,
  getRagConfig,
  RAG_CONFIG_TTL
}
