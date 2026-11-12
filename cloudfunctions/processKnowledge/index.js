/**
 * processKnowledge 云函数入口
 *
 * 职责：仅做 action 路由分发，业务逻辑全部下沉到 handlers/ 目录
 *
 * 模块结构：
 *   config.js              - 配置加载（环境变量、Neo4j 等）
 *   lib/db.js              - cloud 初始化、db 实例、集合工具
 *   lib/ragConfig.js       - RAG 调优配置（5 分钟缓存）
 *   lib/zhipuClient.js     - 智谱 HTTP 客户端 + 响应适配器
 *   lib/embedding.js       - 智谱 Embedding 批量向量化
 *   lib/fileParser.js      - 文件文本抽取（含图片 OCR）
 *   lib/textChunker.js     - 文本分块
 *   lib/vectorSearch.js    - 余弦相似度检索
 *   handlers/chat.js       - chat.complete / chat.saveMessage(s)
 *   handlers/ragConfig.js  - rag.config.get
 *   handlers/zhipuKb.js    - kb.zhipu.* 系列（智谱托管知识库）
 *   handlers/personalKb.js - personal.* 系列（自建 RAG）
 *   handlers/neo4jGraph.js - kb.graph.fetch（Neo4j 知识图谱）
 */

// 引入各 handler 模块（模块加载时即完成 cloud.init 等初始化）
const chat = require('./handlers/chat')
const ragConfig = require('./handlers/ragConfig')
const zhipuKb = require('./handlers/zhipuKb')
const personalKb = require('./handlers/personalKb')
const neo4jGraph = require('./handlers/neo4jGraph')
const hybridRag = require('./handlers/hybridRag')
const { maskId } = require('./lib/db')

// action → handler 路由表（集中管理，新增 action 在此登记即可）
const ACTION_ROUTES = {
  // ===== 智谱托管知识库 =====
  'kb.zhipu.search':           zhipuKb.handleZhipuKBSearch,
  'kb.zhipu.documents':        zhipuKb.handleZhipuKBDocumentList,
  'kb.zhipu.document.detail':  zhipuKb.handleZhipuKBDocumentDetail,
  'kb.zhipu.document.read':    zhipuKb.handleZhipuKBDocumentRead,
  'kb.zhipu.info':             zhipuKb.handleZhipuKBInfo,
  'kb.hybrid.search':          hybridRag.handleHybridSearch,
  'rag.tuning.search':         hybridRag.handleTuningSearch,
  'rag.test.search':           hybridRag.handleTestSearch,

  // ===== RAG 配置下发 =====
  'rag.config.get':            ragConfig,

  // ===== 智谱对话代理 + 对话消息存储 =====
  'chat.complete':             chat.handleChatComplete,
  'chat.streamToken':          chat.handleChatStreamToken,
  'chat.attachment.extract':   chat.handleChatExtractAttachment,
  'chat.saveMessage':          chat.handleChatSaveMessage,
  'chat.saveMessages':         chat.handleChatSaveMessages,

  // ===== 个人知识库（自建 RAG） =====
  'personal.upload':             personalKb.handlePersonalUpload,
  'personal.list':               personalKb.handlePersonalList,
  'personal.delete':             personalKb.handlePersonalDelete,
  'personal.doc.detail':         personalKb.handlePersonalDocDetail,
  'personal.doc.reprocess':      personalKb.handlePersonalDocReprocess,
  'personal.stats':              personalKb.handlePersonalStats,
  'personal.search':             personalKb.handlePersonalSearch,
  'personal.ask':                personalKb.handlePersonalAsk,
  'personal.history.list':       personalKb.handlePersonalHistoryList,
  'personal.history.sessions':   personalKb.handlePersonalHistorySessions,
  'personal.history.delete':     personalKb.handlePersonalHistoryDelete,
  'personal.session.delete':     personalKb.handlePersonalSessionDelete,

  // ===== Neo4j 云端知识图谱 =====
  'kb.graph.fetch':            neo4jGraph.handleNeo4jGraphFetch
}

exports.main = async (event, context) => {
  const { action, data = {} } = event || {}

  // 诊断日志：确认部署版本 + context 可用字段（OPENID 脱敏）
  let wxCtx = {}
  try {
    wxCtx = require('wx-server-sdk').getWXContext() || {}
  } catch (e) {
    console.warn('[Main] WX context unavailable')
  }
  console.log(`[Main] Action: ${action}, Time: ${new Date().toISOString()}, ` +
    `OPENID: ${wxCtx && wxCtx.OPENID ? maskId(wxCtx.OPENID) : '❌empty'}, ` +
    `context.OPENID: ${context && context.OPENID ? 'yes' : 'no'}`)

  const handler = ACTION_ROUTES[action]
  if (!handler) {
    return { success: false, error: `未知操作: ${action}` }
  }

  try {
    return await handler(data, context)
  } catch (e) {
    console.error('[Main] Unhandled error:', e)
    return { success: false, error: '服务器内部错误，请稍后重试' }
  }
}
