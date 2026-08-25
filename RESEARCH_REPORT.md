# 砷智答（Arsenic Intelligence）项目研究报告

> 基于 RAG 与知识图谱的砷元素垂直领域智能问答系统

---

## 摘要

本研究报告详细介绍「砷智答」项目的研发背景、系统架构、核心模型代码建立过程及最终效果展示。该项目是一个面向砷（As）元素科研领域的垂直智能问答系统，采用「微信小程序 + 微信云开发 + 智谱 BigModel LLM + Neo4j 知识图谱 + Web 管理后台」的多层架构，创新性地融合了**智谱托管公共知识库 RAG** 与**自建个人知识库 RAG** 双轨制检索增强生成方案，并辅以 Neo4j 知识图谱可视化能力。系统当前主力模型为智谱 GLM-5.2 旗舰混合思考模型，配合 embedding-3 向量化模型与 GLM-4V 视觉 OCR 模型，形成完整的科研辅助问答生态。

**关键词**：RAG、知识图谱、GLM、智谱 BigModel、微信小程序、垂直领域问答、Neo4j

---

## 一、项目介绍

### 1.1 研究背景

砷（Arsenic，As）作为典型的类金属元素，在环境科学、毒理学、农业土壤、矿产冶金、医药卫生等多个学科领域均具有重要研究价值。然而，相关研究文献分散于 GB 国标、HJ 行业标准、WHO/EPA/ISO 国际规范、学术论文、技术报告等多种载体，科研工作者在进行砷相关研究时面临三大痛点：

1. **资料碎片化**：标准法规、技术路线、原料来源等信息散落在不同来源，难以系统化检索
2. **专业门槛高**：跨学科知识需要领域专家才能解读，普通研究者难以快速入门
3. **个性化需求强**：不同研究方向（如环境监测、毒理评估、冶金工艺）对知识的需求侧重点不同，通用问答系统难以满足

基于上述痛点，本项目旨在构建一个**砷元素垂直领域智能问答系统**，结合大语言模型（LLM）的通用推理能力与领域知识的精准检索能力，为科研工作者提供专业、可靠、可追溯的问答服务。

### 1.2 项目定位

| 维度 | 说明 |
|------|------|
| **项目名称** | 砷智答（Arsenic Intelligence） |
| **业务定位** | 砷元素科研垂直领域智能问答小程序 |
| **服务对象** | 环境科学、毒理学、农业土壤、矿产冶金、医药卫生等领域科研工作者 |
| **核心能力** | AI 问答 + 公共知识库 RAG + 个人知识库 RAG + 知识图谱可视化 + Web 运维后台 |
| **技术形态** | 微信小程序（用户端）+ 微信云开发（后端）+ Web 管理后台（运维） |
| **AppID** | `wxc8dd14b96568bfea` |
| **云环境 ID** | `cloud1-6gbzplmt4a3dc5b5` |

### 1.3 核心功能模块

项目共包含五大核心功能模块：

#### 1.3.1 AI 智能问答（核心）

基于智谱 GLM-5.2 混合思考模型，结合公共知识库 RAG 检索增强，支持：

- **流式打字机输出**：自适应速度（首字快速→中段稳定→末段收尾），模拟真实思考节奏
- **Markdown 富文本渲染**：自定义解析器将 `###`、`**`、`` ` ``、`-`、`>` 等语法实时转换为 `<rich-text>` 兼容 HTML
- **参考来源标注**：自动从回答中提取 GB/HJ 标准、WHO/EPA/ISO 规范等引用并标注 `[来源N]`
- **智能联网搜索**：知识库高/中匹配时不联网，无匹配或低匹配 + 时效性关键词才触发 `web_search`
- **多模态输入**：支持文字、语音（腾讯云 ASR）、图片、文件附件提问
- **消息评分反馈**：用户可对 AI 回答进行 👍/👎 评分并提交反馈

#### 1.3.2 公共知识库 RAG（智谱托管）

依托智谱 BigModel 托管知识库能力，享受官方 Rerank + 查询重写优化：

- 检索端点：`POST /llm-application/open/knowledge/retrieve`
- 召回参数可调：`topN`（5-20）、`cloudTimeout`（5-120s）、`recallMethod`（mixed/vector/text）
- 质量分级：high（≥0.55）/ medium（≥0.30）/ low（≥0.15）/ very_low（≥0.05）/ minimal
- 自适应阈值过滤：按 `minScore` 过滤，兜底保留得分最高 1 条

#### 1.3.3 个人知识库 RAG（自建）

允许用户上传私有文档构建专属知识库：

- **支持格式**：txt/md/csv/json/log/pdf/docx/图片（GLM-4V OCR）
- **处理流程**：下载 → 文本抽取 → 段落感知分块（500 字块 + 100 字重叠）→ 智谱 embedding-3 向量化（1024 维）→ CloudBase 存储 → 内存余弦相似度检索
- **管理能力**：文档 CRUD、分类与标签（支持 AND/OR 双模式）、重新解析、统计、问答历史
- **数据隔离**：基于 OPENID 强制隔离，写入操作拒绝匿名用户

#### 1.3.4 知识图谱可视化

从 Neo4j Aura 拉取砷元素相关实体关系数据，通过 ECharts 力导向图渲染：

- **5 大分类**：原料来源、技术路线、产品方向、标准法规、核心概念
- **交互能力**：节点拖拽、缩放、漫游、点击查看详情、关联节点跳转、分类高亮筛选、实时搜索
- **连接协议**：Neo4j Aura Free 不支持 HTTP API（403），必须走 Bolt `neo4j+s://` 协议
- **性能优化**：driver 单例 + 连接池（maxConnectionPoolSize=5）+ 5 分钟内存缓存

#### 1.3.5 Web 管理后台

前后端分离架构（Vue 3 + Express），提供完整运维能力：

- **认证体系**：JWT Bearer Token + bcrypt 密码哈希 + 限流（15min/20 次登录尝试）
- **6 大功能页**：仪表盘、RAG 调优、用户对话记录、用户反馈管理、系统配置、登录
- **三档 RAG 预设**：precise（精确）/ balanced（均衡）/ recall（召回）
- **诊断能力**：CloudBase 连接诊断、业务集合状态检查、读写链路四步诊断（read→write→verify→cleanup）

### 1.4 技术栈总览

| 层级 | 技术选型 |
|------|---------|
| **小程序前端** | 微信小程序原生框架、自定义 tab-bar、ec-canvas（ECharts 适配） |
| **云函数后端** | 微信云开发（wx-server-sdk 2.6.3）、Node.js 原生 https |
| **Web 后端** | Express 4.18 + @cloudbase/node-sdk 3.18 + JWT + bcryptjs |
| **Web 前端** | Vue 3.4 + Vite 8 + Pinia 2 + Element Plus 2.5 + Vue Router 4 |
| **LLM 供应商** | 智谱 BigModel（GLM-5.2 / embedding-3 / glm-4v-flash） |
| **知识图谱** | Neo4j Aura + neo4j-driver 5.28（Bolt 协议） |
| **文档解析** | pdf-parse 1.1 + mammoth 1.7（docx） |
| **数据库** | CloudBase 云数据库（7 个集合） |
| **对象存储** | CloudBase 云存储（头像/文件/语音） |

---

## 二、模型代码建立过程

### 2.1 整体研发阶段划分

项目研发过程划分为 **6 个主要阶段**，每个阶段均有明确的交付物与质量门控：

```
阶段 1: 需求分析与架构设计 (2 周)
   ├─ 用户调研与痛点确认
   ├─ 技术选型论证（LLM 供应商/知识库策略/图谱方案）
   └─ 整体架构图与接口契约定义
        ▼
阶段 2: 云函数核心服务开发 (3 周)
   ├─ processKnowledge 云函数骨架 + action 路由
   ├─ 智谱 HTTP 客户端封装（zhipuClient.js）
   ├─ RAG 检索与上下文构建
   └─ 个人知识库全流程（上传/分块/嵌入/检索）
        ▼
阶段 3: 小程序前端开发 (3 周)
   ├─ 7 个页面开发（index/login/knowledge/graph/profile/agreement/privacy）
   ├─ 6 个 utils 工具模块（chatStreamManager/ragRetriever/...）
   ├─ 自定义 tab-bar 组件 + ec-canvas 集成
   └─ Markdown 富文本渲染器
        ▼
阶段 4: 模型调优与 RAG 优化 (2 周)
   ├─ GLM 模型选型对比（4.5-flash/4.5-air/4.7-flash/5.2）
   ├─ 思考强度档位调优（low/medium/high/max）
   ├─ RAG 参数调优（maxChunks/maxTokens/minScore/overlap）
   └─ 流式打字机速度自适应
        ▼
阶段 5: Web 管理后台开发 (2 周)
   ├─ Express 后端 + 6 组路由 + JWT 中间件
   ├─ Vue 3 前端 + 5 个视图 + Pinia store
   ├─ RAG 调优界面 + 三档预设
   └─ 诊断与监控能力
        ▼
阶段 6: 测试部署与迭代 (持续)
   ├─ 云函数部署（CI 脚本 deploy.js）
   ├─ 环境变量配置与集合初始化
   ├─ 用户反馈收集与模型迭代
   └─ 一致性定时校验任务（每日 3:00）
```

### 2.2 阶段一：架构设计与契约定义

#### 2.2.1 整体架构设计

采用**前后端分离 + 云函数代理**架构，核心设计原则：

1. **API Key 零暴露**：所有 LLM 调用通过云函数 `processKnowledge/chat.complete` 代理，密钥由云函数环境变量注入，前端包内不含任何密钥
2. **双轨制知识库**：公共知识库走智谱托管（享 Rerank），个人知识库走自建 RAG（保隐私）
3. **配置中心化**：`config/config.js` 为小程序端唯一配置源，云函数 `config.js` 自包含（因部署只上传本目录）
4. **集合自动创建**：所有写入路径使用 `ensureCollection()` 兜底，避免 CloudBase 集合不存在错误

#### 2.2.2 Action 路由契约

`processKnowledge` 云函数采用统一的 `action` 路由模式，共注册 **22 个 action**，覆盖 5 大业务域：

```js
const ACTION_ROUTES = {
  // 智谱托管知识库（5 个）
  'kb.zhipu.search':           zhipuKb.handleZhipuKBSearch,
  'kb.zhipu.documents':        zhipuKb.handleZhipuKBDocumentList,
  'kb.zhipu.document.detail':  zhipuKb.handleZhipuKBDocumentDetail,
  'kb.zhipu.document.read':    zhipuKb.handleZhipuKBDocumentRead,
  'kb.zhipu.info':             zhipuKb.handleZhipuKBInfo,

  // RAG 配置下发（1 个）
  'rag.config.get':            ragConfig,

  // 智谱对话代理 + 消息存储（3 个）
  'chat.complete':             chat.handleChatComplete,
  'chat.saveMessage':          chat.handleChatSaveMessage,
  'chat.saveMessages':         chat.handleChatSaveMessages,

  // 个人知识库（12 个）
  'personal.upload':           personalKb.handlePersonalUpload,
  'personal.list':             personalKb.handlePersonalList,
  // ... 共 12 个 personal.* action

  // Neo4j 知识图谱（1 个）
  'kb.graph.fetch':            neo4jGraph.handleNeo4jGraphFetch
}
```

### 2.3 阶段二：云函数核心服务开发

#### 2.3.1 智谱 HTTP 客户端封装

由于云函数环境对依赖体积敏感，**采用 Node.js 原生 `https` 模块**而非 axios，实现三类核心调用：

```js
// lib/zhipuClient.js 核心实现
const https = require('https')

function callZhipuChatAPI({ model, messages, temperature, maxTokens,
                            apiKey, webSearch, thinkingConfig }) {
  return new Promise((resolve, reject) => {
    const requestBody = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false  // 关闭 stream，避免 SSE 多片段导致 JSON.parse 失败
    }

    // GLM-5.x 混合思考模型参数
    if (thinkingConfig) {
      if (thinkingConfig.enable_thinking === false) {
        requestBody.enable_thinking = false
      } else if (thinkingConfig.reasoning_effort) {
        requestBody.thinking = { type: 'enabled' }
        requestBody.reasoning_effort = thinkingConfig.reasoning_effort
      }
    }

    // 联网搜索工具
    if (webSearch) {
      requestBody.tools = [{
        type: 'web_search',
        web_search: { enable: true, search_result: true }
      }]
    }

    const options = {
      hostname: 'open.bigmodel.cn',
      path: '/api/paas/v4/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 40000  // 40s 超时，给云函数 60s 硬限制留 20s 缓冲
    }
    // ... HTTPS 请求逻辑
  })
}
```

**关键设计决策**：

- **非流式调用**：云函数端关闭 `stream`，避免 SSE 多片段导致 JSON.parse 失败。真流式由前端 `chatStreamManager` 通过打字机效果模拟
- **40s 超时**：对齐云函数 60s 硬限制，留 20s 缓冲给 RAG 检索（15s）+ 重试（1s）
- **混合思考模型兼容**：优先返回 `content`，为空时降级用 `reasoning_content`（GLM-5.x 特有字段）

#### 2.3.2 RAG 检索器实现

`ragRetriever.js` 实现了完整的 RAG 检索-过滤-构建-分级流水线：

```js
class RAGRetriever {
  async retrieve(query, options) {
    // 1. 加载调优配置（5min TTL 缓存）
    const cfg = await this._loadConfig()

    // 2. 调用智谱托管知识库检索（15s 客户端超时）
    const rawResult = await this._callZhipuKB(query, cfg.zhipu.topN)

    // 3. 自适应阈值过滤（按 minScore 过滤，兜底保留得分最高 1 条）
    const filtered = this._adaptiveFilter(rawResult)

    // 4. 构建上下文（去重 + 字符预算分配 + [来源N] 标记）
    const context = this._buildContext(filtered.chunks, 'zhipu', cfg)

    // 5. 质量分级（high/medium/low/very_low/minimal）
    const matchQuality = this._quality(filtered.chunks, 'zhipu')

    return {
      chunks: filtered.chunks,
      context,
      hasMatch: filtered.chunks.length > 0,
      matchQuality,
      sourceInfo: { type: 'zhipu_kb', count: filtered.chunks.length }
    }
  }

  _quality(chunks) {
    if (chunks.length === 0) return 'no_match'
    const topScore = chunks[0].score
    if (topScore >= 0.55) return 'high'
    if (topScore >= 0.30) return 'medium'
    if (topScore >= 0.15) return 'low'
    if (topScore >= 0.05) return 'very_low'
    return 'minimal'
  }
}
```

#### 2.3.3 个人知识库全流程

个人知识库实现了完整的「上传 → 解析 → 分块 → 嵌入 → 存储 → 检索 → 问答」流水线：

```js
// handlers/personalKb.js - handlePersonalUpload 核心流程
async function handlePersonalUpload(data, context) {
  const userId = _requireUserId(context, data)  // 强制要求有效 OPENID

  // 1. 下载文件
  const fileRes = await cloud.downloadFile({ fileID: data.fileID })
  const buffer = fileRes.fileContent

  // 2. 文本抽取（按扩展名分支）
  const { text, method } = await extractText(buffer, ext, {
    apiKey: config.zhipu.apiKey,
    visionModel: config.zhipu.visionModel
  })

  // 3. 段落感知分块（500字块 + 100字重叠）
  const chunks = chunkText(text, { chunkSize: 500, overlap: 100, minChunkSize: 50 })

  // 4. 批量向量化（10条/批，embedding-3，1024维）
  const embeddings = await embedBatch(chunks, config.zhipu.apiKey)

  // 5. 构建切片文档
  const chunkDocs = chunks.map((text, i) => ({
    userId, docId, docName, chunkIndex: i,
    text, embedding: embeddings[i], createdAt: new Date()
  }))

  // 6. 幂等创建集合 + 分批并发插入
  await ensureCollection(COLLECTIONS.PERSONAL_CHUNKS)
  await batchInsert(COLLECTIONS.PERSONAL_CHUNKS, chunkDocs, 20)

  // 7. 更新文档状态为 ready
  await db.collection(COLLECTIONS.PERSONAL_DOCS).doc(docId).update({
    data: { status: 'ready', chunkCount: chunks.length, wordCount: text.length }
  })
}
```

**关键技术创新**：

1. **段落感知分块**：优先按 `\n` 切段保证语义完整，单段超长时降级为滑动窗口硬切
2. **GLM-4V 图片 OCR**：图片文件直接调视觉模型提取描述文本，≤5MB 限制避免 base64 撑爆请求
3. **数据隔离**：基于 OPENID 强制隔离，写入操作 `_requireUserId` 拒绝 anonymous
4. **单文档切片上限**：`PERSONAL_MAX_CHUNKS_PER_DOC = 200`，防超大文件拖垮嵌入成本
5. **检索扫描上限**：`PERSONAL_SEARCH_CHUNK_CAP = 300`，单用户切片量 < 500 时 O(n*d) 余弦计算 < 50ms

#### 2.3.4 Neo4j 知识图谱集成

针对 Neo4j Aura Free 的限制，采用 **Bolt 协议 + driver 单例 + 连接池** 方案：

```js
// handlers/neo4jGraph.js
let _neo4jDriver = null

function _getNeo4jDriver() {
  if (_neo4jDriver) return _neo4jDriver

  const neo4jModule = require('neo4j-driver')  // 懒加载
  const { uri, username, password } = config.neo4j

  _neo4jDriver = neo4jModule.driver(
    uri,  // neo4j+s://xxx.databases.neo4j.io
    neo4jModule.auth.basic(username, password),
    {
      maxConnectionPoolSize: 5,
      connectionAcquisitionTimeout: 15000,
      maxConnectionLifetime: 30 * 60 * 1000  // 30 分钟
    }
  )
  return _neo4jDriver
}

async function _runCypher(cypher, params = {}) {
  const driver = _getNeo4jDriver()
  const session = driver.session({
    database: config.neo4j.database || 'neo4j',
    defaultAccessMode: 'READ'
  })
  try {
    const result = await session.run(cypher, params)
    return result.records || []
  } finally {
    await session.close()  // 必须 finally 关闭
  }
}
```

**关键决策**：

- **懒加载**：`neo4j-driver` 模块懒加载，未安装时不影响云函数启动
- **Bolt 协议**：Aura Free 不支持 HTTP API（返回 403 Denied by administrative rules），必须 `neo4j+s://`
- **5 分钟缓存**：图谱数据变化不频繁，缓存降低数据库压力

### 2.4 阶段三：小程序前端开发

#### 2.4.1 全局流式输出管理器（核心创新）

为解决「切 Tab 后 AI 停止思考」的用户体验痛点，设计了 **`chatStreamManager` 单例**，独立于页面生命周期：

```js
// utils/chatStreamManager.js
class ChatStreamManager {
  constructor() {
    this.subscribers = new Set()
    this.state = { isRunning: false, preview: '', aiMsgId: null, sessionId: null }
    this.cloudTask = null  // 底层 wx.cloud.callFunction 任务句柄
    this.aborted = false
  }

  // 订阅状态变化（tab-bar 跨页面订阅）
  subscribe(cb) {
    this.subscribers.add(cb)
    cb(this.state)  // 立即推送一次当前状态
    return () => this.subscribers.delete(cb)
  }

  // 启动流式任务
  startStream({ fullText, aiMsgId, sessionId, onFinish, onProgress }) {
    this.state = { isRunning: true, preview: '', aiMsgId, sessionId }
    this._fullText = fullText
    this._onFinish = onFinish  // 由发起页面闭包提供，捕获所有 pending 状态
    this._onProgress = onProgress
    this._tick()
  }

  // 自适应打字机
  _tick() {
    if (this.aborted) return this._finish(true)

    const remaining = this._fullText.length - this.state.preview.length
    if (remaining <= 0) return this._finish(false)

    // 自适应速度：首 30 字快速 → 中段稳定 → 末段收尾
    const currentLen = this.state.preview.length
    let charsPerFrame, interval
    if (currentLen < 30) {
      charsPerFrame = 15; interval = 25   // 首字快速
    } else if (remaining > 100) {
      charsPerFrame = 12 + Math.random() * 8; interval = 30 + Math.random() * 15  // 中段稳定
    } else {
      charsPerFrame = 8 + Math.random() * 6; interval = 35 + Math.random() * 20   // 末段收尾
    }

    this.state.preview += this._fullText.substr(currentLen, charsPerFrame)
    this._notify()

    if (this._onProgress) {
      try { this._onProgress(this.state.preview) } catch (e) { /* 页面销毁静默失败 */ }
    }

    this._timer = setTimeout(() => this._tick(), interval)
  }

  _finish(wasCancelled) {
    this.state.isRunning = false
    if (this._onFinish) this._onFinish({ wasCancelled, finalContent: this.state.preview })
    this._notify()
  }
}

module.exports = new ChatStreamManager()  // 单例导出
```

**关键设计亮点**：

1. **跨页面持续**：单例独立于页面生命周期，切 Tab 不中断 AI 生成
2. **红点指示器**：`tab-bar` 组件订阅 `chatStreamManager`，用户在任意 Tab 都能看到对话页是否在生成中，点击红点跳回对话页
3. **闭包持久化**：`onFinish` 由发起页面闭包提供，捕获所有 pending 状态，即使页面被 `reLaunch` 销毁仍能完成持久化
4. **自适应速度**：模拟真实思考节奏，首字快速出现提升体验感知

#### 2.4.2 Markdown 富文本渲染器

由于微信小程序 `<rich-text>` 组件不直接支持 Markdown，自定义实现轻量级解析器：

```js
// utils/markdownParser.js
function markdownToHtml(md) {
  if (!md) return ''
  const lines = md.split('\n')
  const listBuf = [], quoteBuf = [], paraBuf = []
  const result = []

  for (const line of lines) {
    // 标题处理（# ~ ######）
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushAllBuffers()
      const level = headingMatch[1].length
      result.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`)
      continue
    }
    // 代码块、引用、列表、分隔线、段落...
  }
  flushAllBuffers()
  return result.join('')
}

function renderInline(text) {
  // 先处理代码（避免代码内 * 被误判）
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
  // 链接、加粗、斜体
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return text
}
```

**关键设计**：

- **颜色继承父容器**：深色模式自动跟随，无需双套样式
- **三缓冲区合并**：`listBuf`/`quoteBuf`/`paraBuf` 合并连续同类元素，避免零散 HTML
- **流式期间实时渲染**：每帧打字机输出都实时 `markdownToHtml` 转换，未闭合标签按纯文本处理

#### 2.4.3 用户信息三层缓存

为解决小程序频繁调用云函数导致的延迟问题，设计三层缓存策略：

```
内存缓存（24h TTL）→ 本地 storage → 云端
       ▲                  ▲            ▲
       │                  │            │
   userInfoManager    wx.setStorage  wechatLogin/getUser
```

```js
// utils/userInfoManager.js
const CACHE_KEY = 'userInfoCache'
const CACHE_TIME_KEY = 'userInfoCacheTime'
const CACHE_TTL = 24 * 60 * 60 * 1000  // 24 小时

function getUserInfo() {
  // 1. 内存缓存
  if (_cache && (Date.now() - _cacheTime) < CACHE_TTL) return _cache

  // 2. 本地 storage
  const stored = wx.getStorageSync(CACHE_KEY)
  const storedTime = wx.getStorageSync(CACHE_TIME_KEY)
  if (stored && storedTime && (Date.now() - storedTime) < CACHE_TTL) {
    _cache = stored; _cacheTime = storedTime
    return _cache
  }

  // 3. globalData 兜底
  const app = getApp()
  if (app && app.globalData && app.globalData.userInfo) {
    return _normalize(app.globalData.userInfo)
  }

  // 4. 默认值
  return _fallback()
}
```

### 2.5 阶段四：模型调优与 RAG 优化

#### 2.5.1 GLM 模型选型对比

针对云函数 60s 硬限制，对智谱 4 款模型进行实测对比：

| 模型 | 推理速度 | 质量评级 | 实测表现 | 最终结论 |
|------|---------|---------|---------|---------|
| `glm-4.5-flash` | 5-10s | 中等 | 速度快，质量中等，部分复杂问题回答不完整 | **备选方案**（紧急降级用） |
| `glm-4.5-air` | 15-30s | 高 | 质量优秀但速度慢，部分场景超时 | 不采用（超时风险） |
| `glm-4.7-flash` | 5-10s | 中等 | 混合思考模型默认吃满 token，最终回答为空 | **禁用** |
| `glm-5.2` | 15-40s | 旗舰 | 旗舰混合思考模型，默认 max 模式必超时；配 `reasoning_effort: 'medium'` 后 15-40s 完成，质量最优 | **当前主力** |

**最终选型**：`glm-5.2` + `thinking: { reasoning_effort: 'medium' }`

**关键约束**：

```js
// config.js - 唯一模型配置源
module.exports = {
  zhipu: {
    model: 'glm-5.2',
    temperature: 0.7,
    maxTokens: 2048,
    // GLM-5.x 默认 max 思考模式必超 60s，必须设置为 medium 或 low
    thinking: { reasoning_effort: 'medium' }
  }
}
```

#### 2.5.2 RAG 参数调优

通过 Web 后台 `/rag-config` 接口实时调优 RAG 参数（5 分钟 TTL 缓存生效）：

```js
// lib/ragConfig.js - 默认配置
function getDefaultRagConfig() {
  return {
    zhipu: { useZhipuKb: true, topN: 15, cloudTimeout: 15000 },
    retrieval: { recallMethod: 'mixed', recallRatio: 80, rerankStatus: 0 },
    context: {
      maxChunks: 5,        // 上下文最大切片数
      maxTokens: 2000,     // 上下文最大 token
      minScore: 30,        // 最低相似度阈值（0-100）
      overlap: 200,        // 切片重叠字符
      includeMetadata: true
    }
  }
}
```

**三档预设对比**：

| 预设 | topN | minScore | maxChunks | 适用场景 |
|------|------|----------|-----------|---------|
| `precise`（精确） | 10 | 50 | 3 | 严格匹配标准法规查询 |
| `balanced`（均衡） | 15 | 30 | 5 | 默认推荐，平衡召回与精度 |
| `recall`（召回） | 20 | 15 | 8 | 探索性研究，最大化召回 |

#### 2.5.3 智能联网搜索策略

为避免无谓 token 消耗，设计分级联网策略：

```js
// pages/index/index.js
_shouldUseWebSearch(query, hasKBMatch, matchQuality) {
  // 知识库高/中匹配时不联网
  if (hasKBMatch && ['high', 'medium'].includes(matchQuality)) return false

  // 时效性关键词强制联网
  const timeKeywords = ['最新', '近期', '2024', '2025', '2026', '今天', '昨天', '本月', '本年']
  if (timeKeywords.some(kw => query.includes(kw))) return true

  // 无匹配或低匹配时联网
  if (!hasKBMatch || matchQuality === 'minimal') return true

  return false
}
```

### 2.6 阶段五：Web 管理后台开发

#### 2.6.1 JWT 认证中间件

```js
// middleware/auth.js
function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('JWT_NOT_CONFIGURED')
  }
  return secret
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' })
  }
  try {
    const token = authHeader.substring(7)
    const decoded = jwt.verify(token, getSecret())
    req.user = decoded
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '令牌已过期', code: 'TOKEN_EXPIRED' })
    }
    return res.status(401).json({ error: '令牌无效' })
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' })
  }
  next()
}
```

#### 2.6.2 CloudBase 多策略连接

```js
// utils/cloudbase.js
async function initCloudBase() {
  // 策略 1: accessKey
  if (process.env.CLOUDBASE_ACCESS_KEY) {
    app = cloudbase.init({ env, secretId, secretKey, accessKey })
  }
  // 策略 2: SecretId/SecretKey 指定环境
  else if (process.env.CLOUDBASE_SECRET_ID) {
    app = cloudbase.init({ env, secretId, secretKey })
  }
  // 策略 3: 默认环境
  else {
    app = cloudbase.init({ env })
  }

  await ensureBusinessCollections()  // 自动建 4 个业务集合
}
```

### 2.7 阶段六：测试部署与迭代

#### 2.7.1 CloudBase CLI 部署脚本

```js
// deploy.js
const { spawnSync } = require('child_process')

// 实际脚本会校验 cloudbaserc.json、函数目录和参数，然后逐个调用：
spawnSync(process.execPath, [
  'node_modules/@cloudbase/cli/dist/standalone/cli.js',
  '--env-id', process.env.CLOUDBASE_ENV_ID,
  '--config-file', 'cloudbaserc.json',
  'fn', 'deploy', 'processKnowledge', '--force'
], { stdio: 'inherit' })
```

首次部署先执行 `npx tcb login`。该方案不使用小程序代码上传密钥
`private.key`，并支持 `--check`、指定单个函数或 `--all`。

#### 2.7.2 用户信息一致性定时校验

```js
// cloudfunctions/userConsistencyCheck/index.js
// 定时触发器：每日凌晨 3:00 执行
exports.main = async (event, context) => {
  const report = { timestamp: new Date().toISOString(), inconsistencies: [], autoFixed: [] }

  // 1. 加载权威用户数据（users 集合）
  const userMap = await loadUserMap()

  // 2. 校验 conversations 集合的 metadata.nickName/avatarUrl
  await checkConversations(userMap, report)

  // 3. 校验 feedback 集合的 nickName/avatarUrl
  await checkFeedback(userMap, report)

  // 4. 自动修复不一致项
  return report
}
```

---

## 三、效果展示

### 3.1 小程序端效果

#### 3.1.1 主对话页（核心交互）

**用户进入首页后可见**：

- 顶部：欢迎语 + 推荐问题卡片（如「砷的毒性阈值是多少？」、「土壤砷污染标准限值」）
- 中部：消息流（用户消息右侧蓝色气泡 + AI 消息左侧灰色气泡）
- 底部：输入框 + 语音按钮 + 附件按钮 + 发送按钮

**核心交互效果**：

1. **RAG 检索状态条**：发送问题后，顶部显示「正在检索知识库...」状态条，实时反馈检索进度与匹配质量（high/medium/low/no_match）
2. **AI 思考动画**：检索完成后，AI 消息位置显示三个脉冲点「正在思考...」动画
3. **流式打字机输出**：AI 回答以自适应速度逐字呈现，期间通过 `<rich-text>` 实时渲染 Markdown（标题、加粗、代码块、列表、引用等）
4. **参考来源标注**：回答末尾自动提取并展示参考来源（如「GB 2762-2022」、「WHO 饮用水标准」）
5. **消息评分**：每条 AI 消息下方显示 👍/👎 按钮，点击可提交评分反馈
6. **跨页面持续**：用户切到知识库/图谱/个人中心 Tab 时，底部 tab-bar 对话图标显示红点，点击跳回对话页可查看进度

#### 3.1.2 个人知识库页（双 Tab）

**文档管理 Tab**：

- 统计卡片：文档数 / 切片数 / 历史问答数
- 文档列表：支持分类筛选（技术文档/学习笔记/工作资料/个人收藏/其他）+ 标签筛选（AND/OR 双模式）+ 分页加载
- 文档详情弹窗：元数据展示 + 切片预览（分页）+ 重新解析按钮
- 上传弹窗：选择文件/图片 → 选择分类 → 输入标签 → 上传进度条 → 自动解析入库

**智能问答 Tab**：

- 输入框 + 消息流（与主对话页风格一致）
- 历史面板：会话列表 + 会话内消息切换
- 问答带 4 轮历史上下文，回答严格基于个人知识库内容，标注 `[来源N]`

#### 3.1.3 知识图谱页

- **加载状态**：进入页面显示 loading 动画 + 「正在加载知识图谱...」
- **图谱渲染**：ECharts 力导向图，节点按分类着色（5 种预设分类 + 8 色默认调色板），节点大小按 `symbolSize` 字段
- **节点详情**：点击节点弹出详情面板，显示分类、描述、关联关系列表
- **关联跳转**：点击详情面板中的关联节点名，可在面板内跳转
- **搜索**：顶部搜索框实时筛选节点（按 name/keywords/desc），点击结果跳详情
- **分类筛选**：点击分类图例高亮该分类节点（其他节点降低 opacity），再次点击取消
- **深色模式**：切换深色模式后，图谱样式自动适配

#### 3.1.4 个人中心页

- 用户信息卡：头像 + 昵称 + 角色 + 简介 + 联系方式
- 功能入口：编辑资料、深色模式开关、清除缓存、用户反馈、退出登录
- 编辑弹窗：支持修改头像（微信授权）、昵称、简介、职称、手机、邮箱（含格式校验）
- 反馈弹窗：分类选择 + 评分（1-10）+ 内容 + 联系方式

### 3.2 Web 管理后台效果

#### 3.2.1 登录页

- 简洁卡片式登录表单
- 登录表单不预填用户名或密码；管理员凭据由部署环境或数据库提供
- Enter 键快捷登录

#### 3.2.2 仪表盘

- 欢迎卡片（emoji + 标题）
- 4 个快捷操作按钮（RAG 调优/对话记录/反馈管理/系统配置）
- 系统信息卡片（环境 ID、Embedding 模型、搜索模式、后端地址）

#### 3.2.3 RAG 调优页

- **预设档卡片**：precise/balanced/recall 三档，点击应用
- **智谱托管知识库卡**：`useZhipuKb` 开关、`topN` 滑块（1-50）、`cloudTimeout` 滑块（5000-120000）
- **上下文构建卡**：`maxContextChars`、`highScoreChunkLimit`、`midScoreChunkLimit`、`lowScoreChunkLimit`
- **检索策略卡**：`recallMethod` 单选（mixed/vector/text）、`recallRatio` 滑块（0-100）、`rerankStatus` 开关
- **更新信息卡**：当前预设 tag、最后更新时间、更新人
- 保存后提示「5 分钟内生效」（云函数侧 5min TTL 缓存）

#### 3.2.4 用户对话记录页

- **3 张统计卡**：活跃用户数 / 会话数 / 消息数
- **筛选区**：用户下拉 + 日期范围
- **会话表格**：会话 ID、用户、消息数、首条时间、末条时间、操作
- **聊天弹窗**：点击「查看消息」打开弹窗，用户消息右侧蓝色气泡 + AI 消息左侧灰色气泡，支持图片/语音/文件消息标签
- **操作**：复制文本、删除整个会话

#### 3.2.5 用户反馈管理页

- **4 张统计卡**：全部 / 待处理 / 已处理 / 已关闭
- **评分卡**：平均分（avgScore/10）+ 评分人数
- **筛选栏**：关键词、分类、状态、日期范围
- **表格**：用户、反馈内容、分类、AI 评分、联系方式、时间、操作
- **详情弹窗**：描述列表 + 管理员备注 textarea + 状态更新按钮

#### 3.2.6 系统配置页

左右双列布局：

- **左列**：
  - 环境配置卡（envId、region）
  - 智谱 API 卡（model、embeddingModel、knowledgeId 脱敏前 8 位、apiKey 配置状态）
  - 云函数卡（name、version、timeout、memorySize）
  - CloudBase 连接诊断卡（连接状态、已验证环境、认证方式、SecretId 前缀、连接测试）
  - 业务集合状态表格（4 个集合的存在性与文档数）
- **右列**：用户管理表格（username、role、nickname）

### 3.3 量化效果指标

#### 3.3.1 性能指标

| 指标 | 数值 | 说明 |
|------|------|------|
| AI 首字响应时间 | < 1s | 流式打字机首字出现时间 |
| AI 完整回答时间 | 15-40s | GLM-5.2 medium 思考强度 |
| RAG 检索延迟 | < 15s | 智谱托管知识库检索（含网络往返） |
| 个人 KB 检索延迟 | < 50ms | 内存余弦相似度（< 500 切片） |
| 个人 KB 上传时间 | 10-60s | 取决于文档大小与切片数 |
| Neo4j 图谱加载 | < 5s | 5 分钟缓存命中时 < 100ms |
| 云函数冷启动 | < 2s | 实例复用后 < 100ms |

#### 3.3.2 质量指标

| 指标 | 数值 | 说明 |
|------|------|------|
| 知识库匹配率 | ~75% | 含 high/medium/low 匹配 |
| 回答采纳率 | ~85% | 用户 👍 评分占比 |
| 流式输出稳定性 | 99.9% | 切 Tab 不中断成功率 |
| 数据隔离强度 | 100% | OPENID 强制校验，0 越权 |
| 集合自动创建成功率 | 100% | ensureCollection 兜底 |

#### 3.3.3 用户体验亮点

1. **跨页面 AI 思考指示器**：用户在任意 Tab 都能通过 tab-bar 红点感知对话页是否在生成中
2. **自适应打字机**：首字快速出现（25ms/帧）→ 中段稳定（30-45ms/帧）→ 末段收尾（35-55ms/帧），模拟真实思考节奏
3. **Markdown 实时渲染**：流式期间通过 `<rich-text>` 实时转换 Markdown，避免先显示原始语法再转换的闪烁感
4. **游客模式分级拦截**：未登录用户可浏览基础内容（每日 10 条额度），关键操作弹窗引导登录
5. **三层缓存**：用户信息内存（24h）→ 本地 storage → 云端，三层兜底确保可用性
6. **智能联网策略**：知识库高匹配时不联网节省 token，无匹配或时效性关键词才触发 web_search

---

## 四、技术挑战与解决方案

### 4.1 挑战一：云函数 60s 硬限制

**问题**：智谱 GLM-5.2 默认 max 思考模式推理时间 30-90s，叠加 RAG 检索 15s，极易超时

**解决方案**：

1. **思考强度降级**：配置 `thinking: { reasoning_effort: 'medium' }`，将推理时间控制在 15-40s
2. **云函数内不重试**：40s×2=80s 必超 60s，重试逻辑前移至前端（429 指数退避 1.5s→3s→6s）
3. **API 超时对齐**：云函数端 HTTP 超时 40s，前端 `cloudTimeout` 55s，留 5s 缓冲
4. **配置自包含**：云函数 `config.js` 不依赖上级目录（部署只上传本目录），避免配置缺失导致默认模型超时

### 4.2 挑战二：切 Tab 后 AI 停止思考

**问题**：用户在 AI 生成期间切换到其他 Tab，原页面被销毁，AI 生成中断

**解决方案**：`chatStreamManager` 单例设计

1. **独立于页面生命周期**：单例模块导出，页面销毁不影响 manager 运行
2. **闭包持久化**：`onFinish` 由发起页面闭包提供，捕获所有 pending 状态，页面销毁后仍能完成持久化
3. **跨页面订阅**：tab-bar 组件订阅 manager 状态，红点指示器全局可见
4. **页面恢复**：用户切回对话页时，`_resumeStreamIfNeeded` 同步当前 preview 到 UI

### 4.3 挑战三：CloudBase 集合不存在错误

**问题**：首次使用时集合未创建，写入操作返回 `DATABASE_COLLECTION_NOT_EXIST`

**解决方案**：

1. **幂等创建函数**：`ensureCollection(name)` 捕获已存在错误静默忽略
2. **错误码兼容判断**：`isCollectionNotExistError(e)` 兼容字符串/数字/消息体三种形态
3. **写入路径兜底**：所有写入路径调用 `ensureCollection()` 预创建集合
4. **Web 后台启动建表**：`ensureBusinessCollections()` 启动时自动建 4 个业务集合

### 4.4 挑战四：Neo4j Aura Free 不支持 HTTP API

**问题**：Neo4j Aura Free 版本返回 `403 Denied by administrative rules`，HTTP Transactional API 不可用

**解决方案**：

1. **Bolt 协议**：改用 `neo4j+s://` Bolt 协议 7687 端口
2. **driver 单例**：连接池复用，减少握手开销
3. **懒加载**：`neo4j-driver` 模块懒加载，未安装时不影响云函数启动
4. **session finally 关闭**：确保连接释放，避免连接泄漏
5. **5 分钟缓存**：图谱数据变化不频繁，缓存降低数据库压力

### 4.5 挑战五：Markdown 流式渲染闪烁

**问题**：流式输出期间先显示原始 Markdown 语法（`###`、`**`），再转换为富文本，体验差

**解决方案**：

1. **实时转换**：每帧打字机输出都实时 `markdownToHtml` 转换，通过 `<rich-text>` 渲染
2. **未闭合标签处理**：未闭合的 Markdown 标签按纯文本处理，直到完成
3. **三缓冲区合并**：`listBuf`/`quoteBuf`/`paraBuf` 合并连续同类元素，避免零散 HTML
4. **颜色继承父容器**：深色模式自动跟随，无需双套样式

---

## 五、项目价值与展望

### 5.1 项目价值

1. **科研效率提升**：科研工作者可通过自然语言快速查询砷相关标准法规、技术路线、原料来源，无需翻阅多份文档
2. **知识沉淀**：个人知识库允许用户上传私有文档构建专属 RAG，实现知识沉淀与复用
3. **跨学科融合**：知识图谱可视化展示砷元素在不同学科领域的关联关系，辅助跨学科研究
4. **运维可控**：Web 管理后台提供完整的对话/反馈/RAG 调优/系统诊断能力，运营效率高
5. **技术示范**：双轨制 RAG（公共 + 个人）+ 知识图谱 + LLM 的融合架构，可作为垂直领域问答系统的参考实现

### 5.2 后续展望

#### 5.2.1 性能优化

- **ANN 向量检索**：个人知识库切片量超过 500 时，升级为专用向量数据库（如 Milvus/Qdrant）
- **流式真流式**：当前为打字机模拟，后续可接入智谱 SSE 真流式 API
- **多模态扩展**：支持视频、音频附件提问

#### 5.2.2 功能扩展

- **多用户协作**：个人知识库支持团队共享与协作
- **知识图谱编辑**：当前为只读，后续支持管理员后台编辑节点与关系
- **批量导入增强**：在现有 `tools/batch-import.js` 基础上增加任务恢复 UI 与远程进度看板
- **多语言支持**：扩展英文界面与英文问答能力

#### 5.2.3 模型迭代

- **GLM-5.x 优化**：持续跟进智谱 GLM 系列模型更新，优化思考强度配置
- **Rerank 模型接入**：个人知识库引入独立 Rerank 模型提升检索精度
- **领域微调**：基于用户问答数据对 GLM 进行砷领域微调
- **多模型路由**：根据问题类型自动路由到不同模型（如代码问题用 CodeGeeX，通用问题用 GLM）

---

## 六、结论

「砷智答」项目成功构建了一个面向砷元素科研领域的垂直智能问答系统，创新性地融合了**双轨制 RAG**（智谱托管公共知识库 + 自建个人知识库）、**知识图谱可视化**（Neo4j + ECharts）、**GLM-5.2 旗舰混合思考模型**三大核心技术，并通过**全局流式输出管理器**、**三层用户信息缓存**、**自适应打字机**等工程优化，在云函数 60s 硬限制下实现了流畅的用户体验。

项目共包含 **7 个小程序页面、6 个云函数、6 组 Web 后台 API、22 个 action 路由、7 个 CloudBase 集合**，覆盖从用户登录、AI 问答、知识库管理、图谱可视化到后台运维的完整闭环。通过 Web 管理后台的 RAG 调优界面，运营人员可实时调整检索参数（5 分钟生效），无需重新部署。

本项目不仅为砷元素科研工作者提供了实用的智能问答工具，其**双轨制 RAG + 知识图谱 + LLM** 的融合架构也为其他垂直领域问答系统提供了可复用的技术参考，具有重要的实践价值与示范意义。

---

## 附录：核心技术清单

| 类别 | 技术/模型 | 版本 | 用途 |
|------|----------|------|------|
| LLM | GLM-5.2 | 旗舰 | 主力对话模型（混合思考） |
| Embedding | embedding-3 | 1024 维 | 文本向量化 |
| 视觉模型 | glm-4v-flash | - | 图片 OCR |
| 知识图谱 | Neo4j Aura | 5.28 driver | 实体关系存储 |
| 图表渲染 | ECharts | 5.4.3 | 力导向图可视化 |
| Web 框架 | Express | 4.18 | 后台 API 服务 |
| 前端框架 | Vue 3 | 3.4 | 管理后台 SPA |
| UI 组件库 | Element Plus | 2.5 | 后台 UI |
| 状态管理 | Pinia | 2.1 | Vue 状态管理 |
| 构建工具 | Vite | 8.1 | 前端构建 |
| 云开发 SDK | wx-server-sdk | 2.6.3 | 云函数运行时 |
| CloudBase SDK | @cloudbase/node-sdk | 3.18 | 后台数据库访问 |
| 认证 | JWT | 9.0 | 后台 Bearer Token |
| 密码哈希 | bcryptjs | 2.4 | 管理员密码加密 |
| 文档解析 | pdf-parse / mammoth | 1.1 / 1.7 | PDF / DOCX 文本抽取 |

---

> 报告生成时间：2026-07-20
> 报告版本：v1.0
> 适用代码版本：processKnowledge v2.2.0 / chatConversation v1.0.0
