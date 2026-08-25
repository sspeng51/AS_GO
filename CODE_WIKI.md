# 砷智答（Arsenic Intelligence）Code Wiki

> 本文档系统化梳理「砷智答」微信小程序 + Web 管理后台 + 云函数后端的整体架构、模块职责、关键类与函数、依赖关系与运行方式，便于上手维护与二次开发。

---

## 目录

- [一、项目概览](#一项目概览)
- [二、整体架构](#二整体架构)
- [三、目录结构总览](#三目录结构总览)
- [四、小程序前端模块](#四小程序前端模块)
  - [4.1 全局入口 app.js / app.json / app.wxss](#41-全局入口-appjs--appjson--appwxss)
  - [4.2 配置中心 config/config.js](#42-配置中心-configconfigjs)
  - [4.3 pages 页面层](#43-pages-页面层)
  - [4.4 utils 工具层](#44-utils-工具层)
  - [4.5 api 前端代理](#45-api-前端代理)
  - [4.6 components 组件层](#46-components-组件层)
- [五、云函数后端模块](#五云函数后端模块)
  - [5.1 processKnowledge（核心 RAG 服务）](#51-processknowledge核心-rag-服务)
  - [5.2 chatConversation（后台对话 CRUD）](#52-chatconversation后台对话-crud)
  - [5.3 wechatLogin（微信登录与用户管理）](#53-wechatlogin微信登录与用户管理)
  - [5.4 feedback（用户反馈）](#54-feedback用户反馈)
  - [5.5 mediaProcess（语音转文字）](#55-mediaprocess语音转文字)
  - [5.6 userConsistencyCheck（一致性定时校验）](#56-userconsistencycheck一致性定时校验)
- [六、Web 管理后台](#六web-管理后台)
  - [6.1 server（Express 后端）](#61-serverexpress-后端)
  - [6.2 client（Vue 3 前端）](#62-clientvue-3-前端)
- [七、数据模型与集合](#七数据模型与集合)
- [八、关键流程时序](#八关键流程时序)
- [九、依赖关系总览](#九依赖关系总览)
- [十、环境变量与配置](#十环境变量与配置)
- [十一、项目运行方式](#十一项目运行方式)
- [十二、关键设计约束与已知问题](#十二关键设计约束与已知问题)

---

## 一、项目概览

| 维度 | 说明 |
|------|------|
| 项目名称 | 砷智答（Arsenic Intelligence） |
| 业务定位 | 砷（As）元素相关的科研垂直知识问答小程序，含个人知识库与知识图谱 |
| 技术形态 | 微信小程序（前端）+ 微信云开发（云函数 + CloudBase 数据库 + 云存储）+ Web 管理后台（Vue 3 + Express）+ 智谱 BigModel LLM |
| LLM 供应商 | 智谱 AI（GLM 系列，当前主力 `glm-5.2` 混合思考模型） |
| 知识库策略 | 双轨制：智谱托管知识库（公共）+ 自建 RAG（个人知识库） |
| 知识图谱 | Neo4j Aura（Bolt 协议 `neo4j+s://`） |
| AppID | `wxc8dd14b96568bfea` |
| 云环境 ID | `cloud1-6gbzplmt4a3dc5b5` |
| 仓库类型 | CommonJS（`package.json` 中 `type: commonjs`） |

### 核心能力

1. **AI 对话**：基于智谱 GLM，支持联网搜索、Markdown 富文本流式输出、参考来源标注、消息评分反馈
2. **公共知识库 RAG**：智谱托管知识库 + Rerank + 查询重写
3. **个人知识库 RAG**：上传文档（txt/md/csv/json/pdf/docx/图片 OCR）→ 分块 → 智谱 Embedding（embedding-3/1024 维）→ 内存余弦检索
4. **知识图谱可视化**：Neo4j 数据 → ECharts 力导向图渲染
5. **管理后台**：用户/对话/反馈/RAG 调优/系统诊断全功能运维

---

## 二、整体架构

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            微信小程序（用户端）                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  对话 index  │  │ 知识库 know │  │ 图谱 graph  │  │ 个人 profile │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │  utils: chatStreamManager / conversationManager / ragRetriever     │
│         │  utils: personalKB / userInfoManager / markdownParser              │
│         │  api/zhipu.js（前端代理 → chat.complete）                          │
└─────────┼──────────────────────────────────────────────────────────────────┘
          │ wx.cloud.callFunction / wx.cloud.uploadFile
          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          微信云开发（CloudBase）                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐            │
│  │ processKnowledge │  │ chatConversation │  │   wechatLogin    │            │
│  │  (RAG 核心,120s) │  │  (后台对话CRUD)  │  │  (登录/用户管理) │            │
│  └────────┬─────────┘  └──────────────────┘  └──────────────────┘            │
│           │                                                                  │
│  ┌────────┴───────┐  ┌──────────────────┐  ┌──────────────────┐            │
│  │  feedback      │  │  mediaProcess    │  │userConsistency   │            │
│  │  (反馈提交查询) │  │  (语音转文字)    │  │  Check(定时校验) │            │
│  └────────────────┘  └──────────────────┘  └──────────────────┘            │
│                                                                              │
│  CloudBase 数据库集合：users / conversations / feedback / rag_config         │
│                    personal_kb_documents / personal_kb_chunks / personal_kb_history │
│  云存储：用户头像 / 上传文件 / 语音片段                                       │
└──────────┬─────────────────────────────────────┬──────────────────────────┘
           │                                     │
           ▼ HTTPS                               ▼ Bolt (neo4j+s://)
┌────────────────────────┐              ┌────────────────────┐
│  智谱 BigModel API     │              │   Neo4j Aura       │
│  - GLM Chat Completions│              │   (知识图谱存储)   │
│  - Embedding (1024 维) │              └────────────────────┘
│  - 托管知识库 Retrieval│
│  - GLM-4V 视觉 OCR     │
└────────────────────────┘
           ▲
           │ Express HTTP /api/*
┌──────────┴─────────────────────────────────────────────────────────────────┐
│                       Web 管理后台 (web-admin)                              │
│  ┌─────────────────── server (Express + CloudBase SDK) ──────────────────┐ │
│  │ routes: auth / system / conversations / feedback / ragConfig / wechat │ │
│  │ middleware: JWT authMiddleware / requireAdmin                          │ │
│  │ utils: cloudbase(多策略连接+cloud://URL解析) / mime                    │ │
│  └────────────────────────────┬──────────────────────────────────────────┘ │
│                               ▼ /api/* (Vite 代理)                          │
│  ┌─────────────────── client (Vue 3 + Element Plus) ─────────────────────┐ │
│  │ views: Login / Dashboard / RagTuning / ConversationList /             │ │
│  │        FeedbackList / SystemConfig                                    │ │
│  │ stores: auth (Pinia)     router: 全局 beforeEach 鉴权守卫              │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、目录结构总览

```
go/
├── app.js                       # 小程序入口
├── app.json                     # 小程序配置（页面注册、权限）
├── app.wxss                     # 全局样式 + 深色模式
├── sitemap.json                 # 小程序搜索索引规则
├── project.config.json          # 微信开发者工具项目配置
├── package.json                 # 顶层工具依赖（CloudBase CLI / esbuild）
├── deploy.js                    # 云函数部署脚本（CloudBase CLI）
├── generate-avatar.js           # 默认头像 PNG 生成器（零依赖）
├── generate-icons.js            # tabBar 图标 PNG 生成器（零依赖）
├── .eslintrc.js                 # ESLint（注入 wx/Page/Component 等全局）
│
├── config/
│   └── config.js                # 小程序端唯一配置源
│
├── api/
│   └── zhipu.js                 # 智谱 API 前端代理客户端
│
├── assets/
│   ├── icons/                   # 8 个 tabBar 图标（81x81）
│   └── images/                  # 默认头像（png/svg）
│
├── pages/                       # 小程序页面（7 个）
│   ├── index/                   # 主对话页（核心）
│   ├── login/                   # 微信授权登录
│   ├── knowledge/               # 个人知识库（文档 + 问答双 Tab）
│   ├── graph/                   # 知识图谱（ECharts）
│   ├── profile/                 # 个人中心
│   ├── agreement/               # 用户协议
│   └── privacy/                 # 隐私政策
│
├── utils/                       # 小程序工具模块
│   ├── chatStreamManager.js     # 全局流式输出单例
│   ├── conversationManager.js   # 本地对话存储管理
│   ├── markdownParser.js        # Markdown → HTML（rich-text 兼容）
│   ├── personalKB.js            # 个人知识库客户端封装
│   ├── ragRetriever.js          # RAG 检索器
│   └── userInfoManager.js       # 用户信息三层缓存
│
├── components/
│   ├── ec-canvas/               # ECharts 微信小程序适配组件
│   └── tab-bar/                 # 自定义底部导航 + AI 思考红点
│
├── cloudfunctions/              # 云函数根目录
│   ├── processKnowledge/        # 核心 RAG/对话/知识库/图谱云函数（120s）
│   ├── chatConversation/        # 后台对话 CRUD（专为 web-admin）
│   ├── wechatLogin/             # 微信登录与用户管理
│   ├── feedback/                # 用户反馈
│   ├── mediaProcess/            # 语音转文字
│   └── userConsistencyCheck/    # 用户信息一致性定时校验
│
├── web-admin/                   # Web 管理后台（前后端分离）
│   ├── server/                  # Express 后端
│   └── client/                  # Vue 3 + Vite 前端
│
├── tools/
│   └── README-BATCH-IMPORT.md   # 批量导入工具说明
│
└── stitch_rag/                  # 设计稿与 HTML 原型
    └── arsenic_intelligence/
        └── DESIGN.md            # Material 3 风格设计规范
```

---

## 四、小程序前端模块

### 4.1 全局入口 app.js / app.json / app.wxss

#### [app.js](file:///c:/Users/29729/Desktop/mine/个人/go/app.js)

**核心职责**：小程序全局入口，负责云开发初始化、登录态恢复、深色模式广播、版本更新检测。

**globalData 字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `userInfo` | Object\|null | 用户信息（nickName/avatarUrl/openid 等） |
| `isLoggedIn` | boolean | 是否已登录 |
| `isGuest` | boolean | 是否游客模式 |
| `cloudInitialized` | boolean | 云开发是否就绪 |
| `userId` / `token` | string\|null | 用户标识 / openid |
| `darkMode` | boolean | 深色模式开关 |

**关键方法**：

- `onLaunch()` — 初始化云开发 + 恢复 token 登录态 + 加载深色模式 + 注册 `updateManager`
- `initCloud()` — 初始化 `wx.cloud`，环境 ID `cloud1-6gbzplmt4a3dc5b5`
- `checkLoginStatus()` → `boolean` — 读取本地 token 判断登录态
- `requireLogin(redirectUrl, purpose)` → `Promise<boolean>` — 弹窗引导登录
- `toggleDarkMode(enabled)` — 切深色模式并广播到所有页面
- `_notifyDarkModeChange(enabled)` — 遍历 `getCurrentPages()` 调用各页面 `onDarkModeChange` 钩子

#### [app.json](file:///c:/Users/29729/Desktop/mine/个人/go/app.json)

注册 7 个页面，未使用原生 tabBar（改用自定义 `components/tab-bar`）。`networkTimeout` 配置 request 30s / uploadFile 60s / connectSocket 15s。声明权限：`scope.record`（语音）、`scope.album`（相册）、`scope.camera`（相机）。

#### app.wxss

全局样式 + 深色模式适配（`page.dark-theme` 类覆盖 `.container`、`.card`、`.search-input` 等通用样式）。

---

### 4.2 配置中心 [config/config.js](file:///c:/Users/29729/Desktop/mine/个人/go/config/config.js)

小程序端运行配置（云函数部署包保留独立配置，并由测试校验关键值一致）：

| 配置项 | 值 | 说明 |
|--------|----|------|
| `stream.serverUrl` | 空字符串 | 流式服务地址；留空自动降级为云函数模式 |
| `timeouts.cloudFunction` | `115000` | 云函数客户端超时，低于云端 120s 上限 |
| `zhipu.model` | `glm-5.2` | 当前主力模型（混合思考） |
| `zhipu.thinking` | `{ reasoning_effort: 'medium' }` | 思考强度档位（避免 max 超时） |
| `zhipu.embedding` | `embedding-3 / 1024 维` | 向量化模型 |
| `cloud.envId` | `cloud1-6gbzplmt4a3dc5b5` | 云开发环境 ID |
| `cloud.collections` | `conversations / messages / knowledge_base` | 集合名（小程序端用） |

> API Key 不入前端包，由云函数环境变量 `ZHIPU_API_KEY` 或 `BIGMODEL_API_KEY` 注入。

---

### 4.3 pages 页面层

#### 4.3.1 [pages/index/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/index/index.js) — 主对话页（核心）

**职责**：AI 问答主页，集成 RAG 检索、流式输出、语音输入、附件上传、历史会话、游客额度、消息评分。

**关键 data**：`inputValue`、`messages`、`groupedHistory`、`isTyping`、`streamingContent`、`isRetrieving`、`retrievalStatus`、`hasKBMatch`、`matchQuality`、`isRecording`、`recordTime`、`attachments`、`isGuest`、`GUEST_DAILY_LIMIT=10`、`guestRemaining`、`recommendations`、`darkMode`。

**核心方法**：

| 方法 | 职责 |
|------|------|
| `sendMessage()` | 发送消息主流程（游客校验 → RAG 检索 → LLM 调用 → 流式打字机 → 持久化） |
| `_callZhipuAPIStream(messageHistory, aiMsgId, retrievedChunks, hasKBMatch, useWebSearch)` | 调 LLM 带重试 |
| `_onStreamFinish({ aiMsgId, sessionId, finalContent, ... })` | 流式结束持久化回调 |
| `_shouldUseWebSearch(query, hasKBMatch, matchQuality)` | 智能联网判断（无匹配或时效性关键词才触发） |
| `_saveRoundToCloud(userContent, aiContent)` | 批量保存一轮对话到云端 |
| `_callCloudWithRetry(name, data, maxRetries)` | 带重试的云函数调用 |
| `_resumeStreamIfNeeded()` | 切回页面时恢复流式 UI |
| `stopGeneration()` | 停止生成（abort 云函数 + 停打字机） |
| `onVoiceStart/End()`、`_onRecordStop(res)` | 语音录入与识别 |
| `onCamera()` / `onChooseImage()` / `onChooseFile()` | 附件上传 |
| `onThumbUp/Down(e)`、`_submitRating(...)` | 消息评分反馈 |
| `extractSources(content)` | 从回答提取参考来源（GB/HJ 标准、WHO/EPA/ISO） |
| `groupByDate(conversations)` | 历史按今天/最近7天/更早分组 |

**调用云函数 action**：`chat.complete`、`chat.saveMessages`、`chat.saveMessage`、`kb.zhipu.search`（经 ragRetriever）、`rag.config.get`（经 ragRetriever）、`speechToText`、`feedback/submit`。

#### 4.3.2 [pages/login/login.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/login/login.js) — 登录页

**职责**：微信授权登录（code 换 openid + 用户入库），收集头像与昵称，支持游客模式入口。

**核心方法**：`onLoad(options)`（解析 redirect）、`onAgreeChange(e)`、`onWechatLogin()`、`_wxLogin()`（Promise 化 `wx.login`）、`_callLoginCloud(code, nickName, avatarUrl)`、`onChooseAvatar(e)`、`onNickNameInput(e)`、`_checkCanLogin()`、`onGuestEntry()`。

**调用**：`wechatLogin/login`、`wx.cloud.uploadFile`（头像上传）。

#### 4.3.3 [pages/knowledge/knowledge.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/knowledge/knowledge.js) — 个人知识库

**职责**：双 Tab 页面（文档管理 + 智能问答），文档 CRUD、上传/重新解析、问答带 4 轮历史。

**关键 data**：`activeTab`（docs/qa）、`documents`、`stats`、`uploadModal`、`detailModal`（含 chunks 分页）、`messages`、`qaInput`、`sessions`、`history`。

**核心方法**：`switchTab`、`loadStats`、`refreshDocuments`、`loadMoreDocuments`、`filterByCategory`、`toggleTag`（支持 AND/OR）、`openDocDetail`、`_loadDocDetailChunks`、`reprocessDoc`、`deleteDoc`、`openUpload`、`pickFile/pickImage`、`submitUpload`、`sendQuestion`、`newConversation`、`loadSessions`、`openSession`、`resumeSession`、`deleteSession`、`deleteHistory`、`loadHistoryItem`。

**调用**：`personal.*` 系列（全部经 `utils/personalKB.js` 封装）。

#### 4.3.4 [pages/graph/graph.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/graph/graph.js) — 知识图谱

**职责**：从 Neo4j 拉图谱数据 → ECharts 力导向图渲染 → 节点点击详情 + 搜索 + 分类筛选 + 深色适配。

**核心方法**：`_fetchGraphData`、`_buildIndexes(graphData)`（节点详情字典 + 分类统计 + 双向关系）、`_applyCategoryStyles`、`_initChart`、`_buildChartOption(highlightCategory)`、`onSearchInput`、`onSearchResultTap`、`onCategoryTap`、`onResetView`、`onLinkTap`、`onLegendTap`、`onRetryFetch`。

**预设分类**：原料来源、技术路线、产品方向、标准法规、核心概念（5 类 + 8 色默认调色板）。

**调用**：`processKnowledge/kb.graph.fetch`。

#### 4.3.5 [pages/profile/profile.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/profile/profile.js) — 个人中心

**职责**：用户信息展示与编辑、深色模式切换、缓存清理、反馈提交、退出登录。

**核心方法**：`loadUserInfo`、`loadPreferences`、`calcCacheSize`、`onEditProfile`、`onChooseAvatar`、`onNickNameInput/onBioInput/...`、`onSaveProfile`、`saveUserInfo`、`onToggleDarkMode`、`_setPageDarkClass`、`onClearCache`、`onOpenFeedback`、`onSubmitFeedback`、`onLogout`、`onGuestLogin`。

**云端刷新节流**：5 分钟内不重复请求 `wechatLogin/getUser`。

#### 4.3.6 [pages/agreement/agreement.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/agreement/agreement.js) / [pages/privacy/privacy.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/privacy/privacy.js)

纯展示协议页，仅做深色模式适配。

---

### 4.4 utils 工具层

#### 4.4.1 [utils/chatStreamManager.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/chatStreamManager.js) — 全局流式输出管理器（单例）

**职责**：单例管理 AI 回答的打字机式流式输出，独立于页面生命周期，解决「切 Tab 后 AI 停止思考」问题。

**关键方法**：

| 方法 | 说明 |
|------|------|
| `subscribe(cb)` | 订阅状态变化，返回取消订阅函数 |
| `getState()` | 返回 `{ isRunning, preview, aiMsgId, sessionId }` |
| `isRunning()` / `isWaitingCloud()` | 状态查询 |
| `setCloudTask(task)` / `clearCloudTask()` | 管理底层 cloud.callFunction 任务句柄（供 abort） |
| `startStream({ fullText, aiMsgId, sessionId, onFinish, onProgress })` | 启动流式任务 |
| `cancel()` | 用户主动取消 |
| `attachProgress(cb)` | 重新挂载 onProgress（页面 onShow 恢复时用） |

**自适应打字机**：首 30 字快速（15字/帧, 25ms）→ 中段稳定（12-20字/帧, 30-45ms）→ 末段收尾（8-14字/帧, 35-55ms）。

**关键设计**：`onFinish` 由发起页面闭包提供，捕获所有 pending 状态，即使页面被 reLaunch 销毁仍能完成持久化。

**被订阅方**：`pages/index/index.js` 与 `components/tab-bar/tab-bar.js`。

#### 4.4.2 [utils/conversationManager.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/conversationManager.js) — 本地对话管理器

**职责**：本地存储的对话历史 CRUD + 消息上限控制。

**关键方法**：`getAllConversations`、`saveAllConversations`、`createNewConversation(title='新对话')`、`getConversation(id)`、`updateConversation(id, updates)`、`addMessage(conversationId, message)`（超过 100 条移除最早）、`deleteConversation(id)`、`clearAllConversations`、`setCurrentConversation`、`getCurrentConversation`、`getRecentConversations(limit=10)`、`generateId`、`getCurrentTimestamp`。

**关键属性**：`storageKey = 'conversations'`、`maxMessagesPerConv = 100`、`currentConversationId`。

#### 4.4.3 [utils/markdownParser.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/markdownParser.js) — Markdown 解析器

**职责**：轻量级 Markdown → HTML，输出兼容微信小程序 `<rich-text>` 组件。

**导出函数**：

- `markdownToHtml(md)` → `string` — 主解析
- `renderInline(text)` — 行内格式（加粗/斜体/行内代码/链接）
- `escapeHtml(text)` — HTML 转义（`& < >`）

**支持语法**：6 级标题、加粗、斜体、行内代码、代码块、无序/有序列表、引用、分隔线、链接、段落。

**实现**：三缓冲区（`listBuf`/`quoteBuf`/`paraBuf`）合并连续同类元素；颜色继承父容器（深色模式自动跟随）；纯原生 JS，无第三方依赖。

#### 4.4.4 [utils/personalKB.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/personalKB.js) — 个人知识库客户端

**职责**：封装与 `processKnowledge` 的 `personal.*` 系列交互。

**类**：`PersonalKB`（静态属性 `SUPPORTED_EXTS`、`CATEGORIES`）。

**关键方法**：

| 方法 | 用途 |
|------|------|
| `chooseMessageFile(count)` / `chooseImage()` / `isSupported(fileName)` | 文件选择 |
| `upload({ filePath, fileName, category, tags, onProgress })` | 上传（先云存储再触发云函数解析嵌入） |
| `listDocuments({ page, size, category, tag, tags, tagMode })` | 文档列表 |
| `deleteDocument(documentId)` | 删除文档 |
| `getDocDetail({ documentId, chunkPage, chunkSize })` | 文档详情 |
| `reprocessDocument(documentId)` | 重新解析 |
| `getStats()` | 统计 |
| `search({ query, topK })` | 向量检索 |
| `ask({ question, history, sessionId })` | 智能问答 |
| `listHistory({ page, size, sessionId })` / `listSessions()` / `deleteHistory(id)` / `deleteSession(id)` | 历史管理 |

**常量**：`CLOUD_FUNCTION='processKnowledge'`、`SUPPORTED_EXTS`（txt/md/csv/json/pdf/docx/png/jpg/...）、`CATEGORIES`（技术文档/学习笔记/工作资料/个人收藏/其他）、`cloudTimeout=120000`。

#### 4.4.5 [utils/ragRetriever.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/ragRetriever.js) — RAG 检索器

**职责**：智谱托管知识库检索器，拉调优配置 → 调云函数检索 → 自适应阈值过滤 → 构建上下文 → 质量分级。

**类**：`RAGRetriever`。

**关键方法**：

- `constructor(options)` — 接受 `{ topK, cloudTimeout, userId }`
- `retrieve(query, options)` → `{ chunks, context, hasMatch, matchQuality, sourceInfo, isUnavailable? }`
- `_loadConfig()` — 拉 `rag.config.get` 并缓存
- `_callZhipuKB(query, topK)` — 调 `kb.zhipu.search`（15s 超时）
- `_adaptiveFilter(result)` — 按 `context.minScore` 阈值过滤，兜底保留得分最高 1 条
- `_buildContext(chunks, searchMode, cfg)` — 去重 + 字符预算分配（maxTokens*4）+ `[来源N]` 标记
- `_quality(chunks, searchMode)` — top score 分级（high≥0.55 / medium≥0.30 / low≥0.15 / very_low≥0.05 / minimal）
- `getNoMatchPrefix()` — 无匹配时的系统提示前缀

**默认配置**：`zhipu.{useZhipuKb:true, topN:15, cloudTimeout:15000}`、`retrieval.{recallMethod:'mixed', recallRatio:80, rerankStatus:0}`、`context.{maxChunks:5, maxTokens:2000, minScore:30, overlap:200, includeMetadata:true}`。

#### 4.4.6 [utils/userInfoManager.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/userInfoManager.js) — 用户信息管理器

**职责**：统一用户信息管理（对话界面头像、个人中心编辑、后台关联），三层缓存：内存（24h TTL）→ 本地 storage → 云端。

**导出函数**：`getUserInfo()`、`refreshFromCloud()`、`updateUserInfo(updates)`、`getAvatarUrl()`、`getDisplayName()`、`getUserSnapshot()`、`onAvatarError()`。

**常量**：`DEFAULT_AVATAR = '/assets/images/default-avatar.png'`、`DEFAULT_NICKNAME = '微信用户'`。

---

### 4.5 api 前端代理 [api/zhipu.js](file:///c:/Users/29729/Desktop/mine/个人/go/api/zhipu.js)

**职责**：智谱 Chat Completions API 的前端代理客户端，所有 LLM 调用通过云函数 `processKnowledge/chat.complete` 代理（API Key 不入前端包）。

**类**：`ZhipuAPI`，云函数客户端超时 115s，上游模型超时 100s，对齐云端 120s 总预算。

真流式调用不会在小程序包内保存共享密钥：客户端先调用 `chat.streamToken` 获取 120s 有效、单次使用的签名令牌，再访问 SSE 服务；令牌签发同时执行用户额度校验。

**关键方法**：

- `chat(messages, options)` → `{ content, usage, model, webSearch, webSearchInfo, finishReason }`
  - `options: { temperature, maxTokens, onStream, maxRetries=1, webSearch, onTask }`
  - 重试：429 指数退避 1.5s→3s→6s；5xx 退避 1s；网络错误退避 1s；用户 ABORTED 直接抛出
- `_callCloudChat({ messages, temperature, maxTokens, webSearch }, options)` — Promise 化 `wx.cloud.callFunction`
  - 通过 `options.onTask` 暴露 task 对象供外部 abort
  - 超时触发 `task.abort()` 并 reject

**关键设计**：`finishReason='length'` 表示因 max_tokens 截断，供前端提示用户发送"继续"。

---

### 4.6 components 组件层

#### 4.6.1 components/ec-canvas/ — ECharts 微信小程序适配

**职责**：封装 Canvas 2D 同层渲染、触摸事件转发、版本兼容。

**关键 properties**：`canvasId`、`echarts`（Object）、`ec`（Object，含 `lazyLoad`、`onInit`）。

**关键方法**：`ready()`（注册 preprocessor 禁用 progressive）、`init(callback)`（基础库 ≥ 2.9.0）、`initByNewWay(callback)`（创建 WxCanvas 实例 + `echarts.setCanvasCreator` + `ec.onInit` 回调）、`canvasToTempFilePath(opt)`、`touchStart/Move/End(e)`（转发到 echarts handler）。

**依赖**：同目录 `wx-canvas.js` + `echarts.js`（精简版 468KB，仅含 graph 图表）。被 `pages/graph/graph.js` 使用。

#### 4.6.2 components/tab-bar/ — 自定义底部导航

**职责**：自定义 Tab 导航（替代原生 tabBar），订阅全局流式状态显示「AI 思考中」红点指示器。

**关键 properties**：`currentTab`（默认 `'index'`）。

**关键 data**：

```js
tabs: [
  { key: 'index',     icon: '💬', text: '对话' },
  { key: 'knowledge', icon: '📚', text: '知识库' },
  { key: 'graph',     icon: '🔗', text: '知识图谱' },
  { key: 'profile',   icon: '👤', text: '个人中心' }
]
```

**关键方法**：

- `lifetimes.attached()` — 订阅 `chatStreamManager.subscribe`
- `lifetimes.detached()` — 取消订阅
- `switchTab(e)` — 切 Tab，触发短震动，游客访问 profile 引导登录，用 `wx.reLaunch` 跳转
- `onStreamingTap()` — 点击对话 Tab 红点跳回对话页查看进度

**亮点**：跨页面「全局 AI 思考指示器」——用户在知识库/图谱/个人中心都能看到对话页是否在生成中。

---

## 五、云函数后端模块

### 5.1 processKnowledge（核心 RAG 服务）

**配置**（[config.json](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/config.json)）：`timeout: 120s`、`memorySize: 512MB`、依赖 `mammoth / neo4j-driver / pdf-parse / wx-server-sdk`。

**入口**：[index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/index.js) 仅做 action 路由分发。

**ACTION_ROUTES 路由表**：

| Action | Handler | 说明 |
|--------|---------|------|
| `kb.zhipu.search` | `zhipuKb.handleZhipuKBSearch` | 智谱托管知识库检索 |
| `kb.zhipu.documents` | `zhipuKb.handleZhipuKBDocumentList` | 文档列表分页 |
| `kb.zhipu.document.detail` | `zhipuKb.handleZhipuKBDocumentDetail` | 文档详情 |
| `kb.zhipu.document.read` | `zhipuKb.handleZhipuKBDocumentRead` | 文档阅读 |
| `kb.zhipu.info` | `zhipuKb.handleZhipuKBInfo` | 知识库概览统计 |
| `rag.config.get` | `ragConfig` | RAG 配置下发 |
| `chat.complete` | `chat.handleChatComplete` | 智谱 GLM 对话补全 |
| `chat.saveMessage` | `chat.handleChatSaveMessage` | 保存单条消息 |
| `chat.saveMessages` | `chat.handleChatSaveMessages` | 批量保存消息（≤20 条） |
| `personal.upload` | `personalKb.handlePersonalUpload` | 上传文档 |
| `personal.list` | `personalKb.handlePersonalList` | 文档列表 |
| `personal.delete` | `personalKb.handlePersonalDelete` | 删除文档 |
| `personal.doc.detail` | `personalKb.handlePersonalDocDetail` | 文档详情 |
| `personal.doc.reprocess` | `personalKb.handlePersonalDocReprocess` | 重新解析 |
| `personal.stats` | `personalKb.handlePersonalStats` | 用户知识库统计 |
| `personal.search` | `personalKb.handlePersonalSearch` | 向量检索 |
| `personal.ask` | `personalKb.handlePersonalAsk` | 智能问答 |
| `personal.history.list` | `personalKb.handlePersonalHistoryList` | 问答历史列表 |
| `personal.history.sessions` | `personalKb.handlePersonalHistorySessions` | 会话列表 |
| `personal.history.delete` | `personalKb.handlePersonalHistoryDelete` | 删除历史 |
| `personal.session.delete` | `personalKb.handlePersonalSessionDelete` | 删除整个会话 |
| `kb.graph.fetch` | `neo4jGraph.handleNeo4jGraphFetch` | Neo4j 图谱获取（5 分钟缓存） |

#### 5.1.1 [config.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/config.js)

**自包含配置**（云函数部署只上传本目录文件，不依赖上级目录）：

- `zhipu.model: 'glm-5.2'`、`thinking: { reasoning_effort: 'medium' }`
- `zhipu.apiKey` 来自环境变量 `ZHIPU_API_KEY` / `BIGMODEL_API_KEY`
- `zhipu.knowledgeId` 来自环境变量 `ZHIPU_KNOWLEDGE_ID`（公共知识库 ID）
- `zhipu.visionModel: 'glm-4v-flash'`（图片 OCR）
- `neo4j.{uri, username, password, database}` 来自环境变量 `NEO4J_*`

#### 5.1.2 lib/ 库

##### [lib/db.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/db.js)

- 模块加载时执行 `cloud.init` 一次（实例复用）
- 导出 `cloud / db / _ / $ / COLLECTIONS / ensureCollection / batchInsert / isCollectionNotExistError`
- `COLLECTIONS`：`CONVERSATIONS='conversations'`、`PERSONAL_DOCS='personal_kb_documents'`、`PERSONAL_CHUNKS='personal_kb_chunks'`、`PERSONAL_HISTORY='personal_kb_history'`
- `PERSONAL_SEARCH_CHUNK_CAP = 300`（单次检索扫描上限）
- `PERSONAL_MAX_CHUNKS_PER_DOC = 200`
- `ensureCollection(name)` 幂等创建集合
- `batchInsert(collectionName, docs, batchSize=20)` 分批并发插入
- `isCollectionNotExistError(e)` 兼容字符串/数字/消息体三种形态判断

##### [lib/zhipuClient.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/zhipuClient.js)

智谱 HTTP 客户端（Node 原生 `https`，无 axios 依赖）。

| 函数 | 端点 | 用途 |
|------|------|------|
| `callZhipuChatAPI({ model, messages, temperature, maxTokens, apiKey, webSearch, thinkingConfig })` | `POST /chat/completions` | GLM 对话补全（非流式），40s 超时 |
| `callZhipuKBRetrieval({ knowledgeId, query, topK, apiKey })` | `POST /llm-application/open/knowledge/retrieve` | 智谱托管知识库检索 |
| `callZhipuKBGet(path, apiKey)` | GET `/llm-application/open/...` | 知识库文档 GET |
| `adaptZhipuResultToRagFormat(zhipuResult, duration)` | — | 检索结果 → 通用 ragResult |
| `adaptZhipuDocument(rawDoc)` | — | 文档 → 前端友好格式 |

**GLM-5.x 混合思考模型参数**：`thinkingConfig.enable_thinking=false` 关闭思考；或 `thinkingConfig.reasoning_effort` 设 low/medium/high/max。

##### [lib/embedding.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/embedding.js)

- `embedBatch(texts, apiKey)` → `Promise<number[][]>`
- 模型 `embedding-3`，1024 维，`BATCH_SIZE=10`（智谱上限 64，10 稳妥）
- 按 index 排序回填，保证输入输出顺序一致

##### [lib/fileParser.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/fileParser.js)

- `extractText(buffer, ext, options)` → `{ text, method, note? }`
- 支持：txt/md/csv/json/log/tsv（UTF-8）、pdf（pdf-parse）、docx（mammoth）、图片（GLM-4V OCR，≤5MB）
- 不支持：.doc 旧格式
- 导出 `IMAGE_EXTS`、`IMAGE_OCR_MAX_BYTES=5MB`、`getExt`、`getFileType`
- pdf-parse / mammoth / https 按需引入

##### [lib/textChunker.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/textChunker.js)

- `chunkText(text, options={ chunkSize=500, overlap=100, minChunkSize=50 })` → `string[]`
- 策略：段落感知优先（按 `\n` 切段），单段超长降级为滑动窗口硬切
- 过滤过短块（< minChunkSize）减少噪声

##### [lib/vectorSearch.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/vectorSearch.js)

- `cosineSimilarity(a, b)` → `number`（0-1 区间）
- `search(queryVec, candidates, topK=5, minScore=0)` → `Array<{ chunkId, docId, docName, chunkIndex, text, score }>`
- 适用：单用户切片量 < 500（O(n*d) < 50ms）；不适合跨用户大规模检索（Phase 3 升级 ANN）

##### [lib/ragConfig.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/ragConfig.js)

- `getRagConfig()` 从 `rag_config/current` 文档读取，5 分钟 TTL 缓存
- `getDefaultRagConfig()` 内置默认值
- 失败回退默认值，不阻塞业务

#### 5.1.3 handlers/

##### [handlers/chat.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/chat.js)

- `handleChatComplete(data, context)` — LLM 调用代理。云函数内不重试，上游 100s / 客户端 115s / 云端 120s
- `handleChatStreamToken(data, context)` — 校验用户额度并签发 120s 有效的单次流式令牌
  - 优先返回 `content`，为空时降级用 `reasoning_content`（混合思考模型特有）
  - 透传 `webSearchInfo`、`finish_reason`（'length' 表示 max_tokens 截断）
- `handleChatSaveMessage(data)` — 保存单条消息到 `conversations` 集合
- `handleChatSaveMessages(data)` — 批量保存（≤20 条），合并为一次云函数调用

##### [handlers/zhipuKb.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/zhipuKb.js)

- `handleZhipuKBSearch(data, context)` — 调用智谱托管知识库检索（Rerank + 查询重写），`topK` 限制 5-20
- `handleZhipuKBDocumentList(data, context)` — 文档列表分页
- `handleZhipuKBDocumentDetail` / `handleZhipuKBDocumentRead` / `handleZhipuKBInfo`

##### [handlers/personalKb.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/personalKb.js)

自建 RAG 全流程。数据模型：

- `personal_kb_documents: { _id, userId, name, fileID, category, tags:[], fileType, size, wordCount, chunkCount, status:'processing'|'ready'|'failed', errorMsg, createdAt, updatedAt }`
- `personal_kb_chunks: { _id, userId, docId, docName, chunkIndex, text, embedding:[1024], createdAt }`
- `personal_kb_history: { _id, userId, question, answer, sources:[{docId,docName,score,snippet}], createdAt }`

**关键工具**：

- `_getPersonalUserId(context, data)` — 优先 `cloud.getWXContext().OPENID` → `context.OPENID` → `data.userId` → `'anonymous'`
- `_requireUserId(context, data)` — 写入操作强制要求有效 OPENID，拒绝 anonymous

**核心 handler**：

| Handler | 流程 |
|---------|------|
| `handlePersonalUpload` | 下载文件 → `extractText` → `chunkText` → `embedBatch` → `batchInsert` 到 chunks → 更新 docs 状态 |
| `handlePersonalSearch` | query 向量化 → 按 userId 取候选切片（cap 300）→ `vectorSearch` → 返回 topK |
| `handlePersonalAsk` | search → 构建 [来源N] 上下文 → GLM-4 生成 → 存 history |
| `handlePersonalList` | 分页 + 分类/标签筛选（tagMode: or/and） |
| `handlePersonalDocDetail` | 元数据 + chunks 分页预览 |
| `handlePersonalDocReprocess` | 重新解析（重新分块 + 嵌入） |
| `handlePersonalStats` | 文档数 + 切片数 + 历史数 + 标签聚合 |
| `handlePersonalHistoryList/Sessions` | 按 sessionId 聚合 |
| `handlePersonalSessionDelete` | 按 sessionId 级联删除 |

**PERSONAL_SYSTEM_PROMPT**：严格要求基于知识库参考内容回答，标注 `[来源N]`，无关时明确告知「知识库中未找到相关内容」。

##### [handlers/neo4jGraph.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/neo4jGraph.js)

- `handleNeo4jGraphFetch` — 拉取节点 + 关系，**5 分钟内存缓存**
- Neo4j driver 懒加载（未安装不影响云函数启动）+ 单例 + 连接池（maxConnectionPoolSize=5）
- Cypher 通过 `session.run` 执行，`finally` 块确保 session 关闭
- Aura Free 不支持 HTTP API（403），必须走 Bolt `neo4j+s://`
- 节点 schema：`name`（必需）/ `desc` / `keywords` / `category` / `symbolSize`

##### [handlers/ragConfig.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/ragConfig.js)

- `handleRagConfigGet(data, context)` — 调用 `getRagConfig()` 下发配置

---

### 5.2 chatConversation（后台对话 CRUD）

**配置**（config.json）：`timeout: 15s`、`memorySize: 256MB`。专为 web-admin 提供。

**入口**：[index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/chatConversation/index.js)。

除 `system.ping` 外，所有动作都必须在事件顶层提供与云函数环境变量
`CHAT_CONVERSATION_ADMIN_SECRET` 一致的至少 32 位管理密钥。

**ACTION_ROUTES**：

| Action | 说明 |
|--------|------|
| `conversation.saveMessage` | 保存对话消息 |
| `conversation.listMessages` | 查询消息列表 |
| `conversation.listSessions` | 查询会话列表 |
| `conversation.deleteSession` | 删除会话 |
| `conversation.listUsers` | 查询活跃用户 |
| `system.ping` | 健康检查 |

#### 模块结构

- **data/db.js** — 数据库操作层。`init(database, command)`、`getDB()`、`getCommand()`、`collection()`、`insertMessage`、`findRecentMessages` 等。`MAX_FETCH_LIMIT=1000`。
- **handlers/saveMessage.js** — 参数验证 + 数据净化 + 构建记录（含 `msg_${Date.now()}_${random}` 格式 ID）
- **handlers/listMessages.js** — 按 `sessionId` + 可选 `userId/dateFrom/dateTo` 分页查消息
- **handlers/listSessions.js** — 按 `sessionId` 聚合会话，返回 firstMessageTime/lastMessageTime/messageCount
- **handlers/deleteSession.js** — 按 `userId+sessionId` 删除整个会话所有消息
- **handlers/listUsers.js** — 从 conversations 去重得到活跃用户列表
- **utils/logger.js** — 分级日志（DEBUG/INFO/WARN/ERROR），格式 `[ISO][ChatConv][LEVEL][module] message | data`
- **utils/response.js** — `success(data, message)` / `paginated(items, pagination)` / `error(msg, code, details)` / `validationError(errors)`
- **utils/validator.js** — 参数验证（`validateSaveMessage`、`validateListSessions`、`MAX_PAGE_SIZE`、`sanitizeContent`、`sanitizeMetadata`）

---

### 5.3 wechatLogin（微信登录与用户管理）

[cloudfunctions/wechatLogin/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/wechatLogin/index.js)

**Actions**：

| Action | 流程 |
|--------|------|
| `login` | 接收 `wx.login()` 的 code → `cloud.openapi.auth.code2Session` 换 openid → 查/建/更新 `users` 集合记录 → 返回 userInfo（含 `isNewUser`、`isDevMode`） |
| `getUser` | 按 openid 或 userId 查 `users` 集合 |
| `updateProfile` | 更新用户资料（nickName/avatarUrl/bio/title/phone/email 等） |

**降级**：微信接口返回错误（-1/0/网络异常）时进入开发模式，生成 `dev_${Date.now()}_${random}` openid。

**users 集合字段**：`openid / unionid / nickName / avatarUrl / role:'user' / status:'active' / loginCount / createdAt / lastLoginAt / updatedAt`。

---

### 5.4 feedback（用户反馈）

[cloudfunctions/feedback/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/feedback/index.js)

**Actions**：

| Action | 说明 |
|--------|------|
| `submit` | 提交反馈（content ≤2000 字，score 1-10 整数） |
| `list` | 反馈列表查询 |

**集合**：`feedback`。

---

### 5.5 mediaProcess（语音转文字）

[cloudfunctions/mediaProcess/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/mediaProcess/index.js)

**Actions**：

| Action | 说明 |
|--------|------|
| `speechToText` | 语音转文字：优先腾讯云 ASR（需 `TENCENT_SECRET_ID/KEY` 环境变量），未配置时降级提示 |

---

### 5.6 userConsistencyCheck（一致性定时校验）

[cloudfunctions/userConsistencyCheck/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/userConsistencyCheck/index.js)

**职责**：定时触发器（每日凌晨 3:00）比对三个场景的用户信息一致性：

1. `conversations` 集合（metadata.nickName, metadata.avatarUrl）
2. `feedback` 集合（nickName, avatarUrl）
3. `users` 集合（权威来源）

**输出**：`{ timestamp, summary, inconsistencies, autoFixed, errors }`。`BATCH_SIZE=100` 分批处理。

---

## 六、Web 管理后台

### 6.1 server（Express 后端）

**位置**：[web-admin/server/](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/)

**入口**：[index.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/index.js)

- 加载 `.env` → 初始化 CloudBase → 创建 Express app
- CORS 白名单：`localhost:5173/3000/3001`、`127.0.0.1`
- 限流：`generalLimiter`（15min/500 次 `/api/`）、`authLimiter`（15min/20 次 `/api/auth/login`）
- JSON/URL 编码上限 50MB
- 启动时 `initCloudBase()` 自动建 4 个业务集合

#### 关键 API 端点

| 路由模块 | 端点 | 方法 | 说明 |
|---------|------|------|------|
| [auth.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/auth.js) | `/api/auth/login` | POST | 登录（users 集合 + bcrypt 校验；可选环境变量独立管理员；签发 JWT 24h） |
| | `/api/auth/me` | GET | 解析当前用户 |
| | `/api/auth/users` | GET | 列出用户（requireAdmin） |
| | `/api/auth/register` | POST | 管理员创建新用户（需 JWT + requireAdmin，bcrypt 加盐，默认 role=viewer） |
| | `/api/auth/status` | GET | 认证方式 + CloudBase 状态 |
| [conversations.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/conversations.js) | `/api/conversations/sync-status` | POST | 管理员同步诊断（含临时写入与清理） |
| | `/api/conversations/diagnose` | POST | 完整读写链路诊断（read→write→verify→cleanup） |
| | `/api/conversations/users` | GET | 活跃用户列表 |
| | `/api/conversations/sessions` | GET | 按 sessionId 聚合会话（支持 userId 过滤+分页） |
| | `/api/conversations/messages` | GET | 按 sessionId 分页查消息（pageSize ≤200） |
| | `/api/conversations/sessions` | DELETE | 删除整个会话 |
| [feedback.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/feedback.js) | `/api/feedback/list` | GET | 反馈列表（status/keyword/category/dateRange 过滤） |
| | `/api/feedback/:id` | PATCH | 更新状态或 adminNote |
| | `/api/feedback/:id` | DELETE | 删除反馈 |
| | `/api/feedback/stats` | GET | 统计（pending/resolved/closed + avgScore） |
| [ragConfig.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/ragConfig.js) | `/api/rag-config` | GET | 读取当前配置 |
| | `/api/rag-config` | PUT | 校验后 upsert 配置 |
| | `/api/rag-config/presets` | GET | 列出三档预设（precise/balanced/recall） |
| | `/api/rag-config/preset` | POST | 按 name 应用预设 |
| [system.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/system.js) | `/api/system/config` | GET | 环境/智谱/云函数配置 |
| | `/api/system/cloudbase-diag` | GET | CloudBase 连接诊断 |
| | `/api/system/collections` | GET | 业务集合状态检查 |
| [wechat.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/wechat.js) | `/api/wechat/login` | POST | code → openid → users 入库 + 签发 JWT |
| | `/api/wechat/check` | GET | 微信配置状态 |
| index.js | `/api/health` | GET | 健康检查 |

#### [middleware/auth.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/middleware/auth.js)

- `authMiddleware(req,res,next)` — 强制 Bearer Token，失败 401（过期/无效）/ 503（未配置）
- `optionalAuth(req,res,next)` — 可选认证
- `generateToken(payload, expiresIn='24h')` — 签发 JWT
- `requireAdmin(req,res,next)` — 校验 `role==='admin'`，否则 403
- `getSecret()` — 运行时校验 `JWT_SECRET` 长度 ≥16

#### [utils/cloudbase.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/utils/cloudbase.js)

- `initCloudBase()` — 多策略连接（accessKey → SecretId/SecretKey 指定环境 → SecretId/SecretKey 默认环境）
- `getDB()` / `getDBOrNull()` / `getApp()` / `isReady()` / `getStatus()`
- `resolveCloudFileURLs(fileIds)` — `cloud://` → HTTPS 批量解析（优先 `getTempFileURL`，失败字符串兜底）
- `ensureBusinessCollections` — 自动建 `users / rag_config / conversations / feedback`

#### 依赖（package.json）

| 依赖 | 用途 |
|------|------|
| `@cloudbase/node-sdk ^3.18.1` | CloudBase SDK |
| `axios ^1.18.0` | CloudBase SDK 的安全版本覆盖 |
| `lodash ^4.17.21` + 本地 set/unset shim | 替换 CloudBase 数据库包的废弃依赖 |
| `bcryptjs ^2.4.3` | 密码哈希 |
| `express ^4.18.2` / `cors ^2.8.5` / `morgan ^1.10.0` | Web 框架 |
| `express-rate-limit ^7.1.4` | 限流 |
| `dotenv ^16.3.1` | 环境变量 |
| `jsonwebtoken ^9.0.2` | JWT |
| `iconv-lite ^0.6.3` | 编码转换 |
| `mammoth ^1.8.0` / `pdf-parse ^1.1.1` | 文档解析 |
| `multer ^1.4.5-lts.1` | 文件上传 |

`routes/wechat.js` 使用 Node 原生 `https`，不再依赖未声明的 axios。`package.json`
中的 axios 仅用于覆盖 CloudBase SDK 的旧间接版本。

---

### 6.2 client（Vue 3 前端）

**位置**：[web-admin/client/](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/)

#### 依赖（package.json）

| 依赖 | 用途 |
|------|------|
| `vue ^3.4.15` / `vue-router ^4.2.5` / `pinia ^2.1.7` | Vue 3 全家桶 |
| `element-plus ^2.5.4` + `@element-plus/icons-vue ^2.3.1` | UI 组件库 |
| `axios ^1.18.0` | HTTP 客户端 |
| `dayjs ^1.11.10` | 时间格式化 |
| `vite ^8.1.5` + `@vitejs/plugin-vue ^6.0.8` | 构建工具 |
| `unplugin-vue-components ^32.1.0` | Element Plus 按需加载 |
| `sass ^1.70.0` | 样式预处理 |

#### [vite.config.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/vite.config.js)

`@` 别名 → `src`，dev server 端口 `5173`，代理 `/api` → `http://localhost:3000`。

#### [src/main.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/src/main.js)

挂载 Pinia、vue-router、Element Plus（中文 locale `zh-cn`）。

#### [src/router/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/src/router/index.js)

| 路径 | 组件 | meta |
|------|------|------|
| `/login` | `Login.vue` | title=登录 |
| `/` → `/dashboard` | `MainLayout.vue` | `requiresAuth: true` |
| `/dashboard` | `Dashboard.vue` | title=仪表盘 |
| `/rag-tuning` | `tuning/RagTuning.vue` | title=RAG调优 |
| `/system` | `system/SystemConfig.vue` | title=系统配置 |
| `/conversations` | `conversations/ConversationList.vue` | title=用户对话记录 |
| `/feedback` | `feedback/FeedbackList.vue` | title=用户反馈管理 |

**守卫**：`router.beforeEach` 设 document.title，`requiresAuth` 路由无 `admin_token` 跳 `/login?redirect=...`，已登录访问 `/login` 自动跳 `/dashboard`。

#### [src/api/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/src/api/index.js)

axios 实例 `baseURL: '/api'`，超时 30s。请求拦截自动注入 `Authorization: Bearer ${admin_token}`。响应拦截：401 清 token+user 跳登录；403/429/5xx 弹 ElMessage。

#### [src/stores/auth.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/src/stores/auth.js)

Composition API 风格 Pinia store。

- State: `token` / `user`（localStorage 初始化）
- Getters: `isLoggedIn` / `isAdmin`
- Actions: `login(username, password)` POST `/auth/login`、`logout()` 清空跳 `/login`

#### [src/layouts/MainLayout.vue](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/src/layouts/MainLayout.vue)

侧边栏（64px/220px 可折叠）+ 顶栏（面包屑 + 用户下拉），暗色主题 `#1a1a2e`。

#### 视图

- **Login.vue** — 登录表单不预填凭据，Enter 键登录
- **Dashboard.vue** — 欢迎卡 + 快捷操作 + 系统信息（部分硬编码）
- **ConversationList.vue** — 3 张统计卡 + 筛选区 + 会话表格 + 聊天弹窗（用户右蓝气泡 + AI 左灰气泡）
  - 关键方法：`loadUsers` / `searchSessions` / `viewMessages` / `loadMessages` / `deleteSession` / `copyText` / `getAvatarUrl`（含 `cloud://` 兜底转换）
- **FeedbackList.vue** — 4 张统计卡 + 评分卡 + 筛选栏 + 表格 + 详情弹窗
  - 关键方法：`fetchStats` / `fetchList` / `onFilterChange` / `resetFilters` / `showDetail` / `updateStatus` / `saveAdminNote` / `deleteFeedback`
- **RagTuning.vue** — 预设档卡片 + 智谱托管知识库卡 + 上下文构建卡 + 检索策略卡 + 更新信息
  - 关键方法：`loadConfig` / `handleSave` / `applyPreset(name)`
- **SystemConfig.vue** — 左右双列布局，4 个接口 `Promise.all` 并行加载

---

## 七、数据模型与集合

### CloudBase 数据库集合

| 集合名 | 写入方 | 读取方 | 关键字段 |
|--------|--------|--------|----------|
| `users` | wechatLogin、web-admin/auth | wechatLogin、userInfoManager、web-admin | `_id, openid, unionid, nickName, avatarUrl, role, status, loginCount, lastLoginAt` |
| `conversations` | processKnowledge/chat、chatConversation | web-admin/conversations、userConsistencyCheck | `_id, userId, sessionId, direction(user/ai), content, messageType, timestamp, metadata{nickName,avatarUrl,source}` |
| `feedback` | feedback | web-admin/feedback、userConsistencyCheck | `_id, userId, content, contact, category, score, nickName, avatarUrl, status, adminNote, createdAt` |
| `rag_config` | web-admin/ragConfig | processKnowledge/lib/ragConfig（5min 缓存） | `current` 文档：`{zhipu, retrieval, context, preset, updatedAt, updatedBy}` |
| `personal_kb_documents` | processKnowledge/personalKb | processKnowledge/personalKb | `_id, userId, name, fileID, category, tags[], fileType, size, wordCount, chunkCount, status, errorMsg, createdAt, updatedAt` |
| `personal_kb_chunks` | processKnowledge/personalKb | processKnowledge/personalKb（向量检索） | `_id, userId, docId, docName, chunkIndex, text, embedding:[1024], createdAt` |
| `personal_kb_history` | processKnowledge/personalKb | processKnowledge/personalKb | `_id, userId, question, answer, sources[{docId,docName,score,snippet}], createdAt` |

### 集合自动创建约定

> CloudBase 集合必须显式创建才能写入。所有写入路径必须使用 `ensureCollection()` 辅助函数（processKnowledge 端）或 `ensureBusinessCollections()`（web-admin 端）兜底。

---

## 八、关键流程时序

### 8.1 用户发送一条 AI 问答（核心流程）

```
[用户] 输入问题 → pages/index.sendMessage()
   │
   ├─ 全用户额度校验（游客与注册用户分别配置日限额/分钟限额）
   │
   ├─ 添加用户消息 + AI 占位消息（脉冲点动画）
   │
   ├─ ragRetriever.retrieve(query)
   │    ├─ _loadConfig() → processKnowledge/rag.config.get（5min 缓存）
   │    ├─ _callZhipuKB(query, topK) → processKnowledge/kb.zhipu.search
   │    │    └─ handlers/zhipuKb → lib/zhipuClient.callZhipuKBRetrieval
   │    │         → 智谱 /llm-application/open/knowledge/retrieve
   │    ├─ _adaptiveFilter（按 minScore 阈值过滤）
   │    ├─ _buildContext（去重 + 字符预算 + [来源N] 标记）
   │    └─ _quality（分级 high/medium/low/very_low/minimal）
   │
   ├─ 按匹配质量分级构建系统提示词
   │
   ├─ _shouldUseWebSearch（无匹配或时效性关键词才触发）
   │
   ├─ _callZhipuAPIStream → api/zhipu.js chat()
   │    └─ wx.cloud.callFunction → processKnowledge/chat.complete
   │         └─ handlers/chat.handleChatComplete
   │              └─ lib/zhipuClient.callZhipuChatAPI
   │                   → 智谱 /chat/completions（非流式，40s 超时）
   │              └─ 优先 content，为空降级 reasoning_content
   │
   ├─ chatStreamManager.startStream(fullText, aiMsgId, sessionId, onFinish, onProgress)
   │    └─ _tick() 自适应打字机
   │         └─ onProgress → markdownToHtml → rich-text 实时渲染
   │
   ├─ tab-bar 订阅 chatStreaming 状态 → 红点指示器（跨页面可见）
   │
   └─ _onStreamFinish
        ├─ conversationManager.addMessage（本地）
        ├─ _saveRoundToCloud → processKnowledge/chat.saveMessages（批量）
        │    └─ 失败降级 chat.saveMessage（单条）
        └─ 更新 UI（评分按钮、参考来源、知识块详情）
```

### 8.2 个人知识库上传

```
[用户] 选文件 → utils/personalKB.upload()
   ├─ wx.cloud.uploadFile → 拿 fileID
   ├─ wx.cloud.callFunction → processKnowledge/personal.upload
   │    └─ handlers/personalKb.handlePersonalUpload
   │         ├─ cloud.downloadFile → buffer
   │         ├─ lib/fileParser.extractText（按 ext 分支：plain/pdf/docx/image OCR）
   │         ├─ lib/textChunker.chunkText（500字块+100字重叠）
   │         ├─ lib/embedding.embedBatch（10条/批 → embedding-3）
   │         ├─ ensureCollection + batchInsert → personal_kb_chunks
   │         └─ 更新 personal_kb_documents.status = 'ready'
   └─ 返回 → 前端刷新列表 + 统计
```

### 8.3 后台管理对话查询

```
[管理员] web-admin ConversationList.vue
   ├─ loadUsers → GET /api/conversations/users
   │    └─ server/routes/conversations.js
   │         ├─ safeGet conversations 去重 → userIds
   │         └─ users 集合补充 nickName/avatarUrl
   │         └─ resolveAvatars（cloud:// → HTTPS）
   │
   ├─ searchSessions → GET /api/conversations/sessions?userId&page
   │    └─ 按 sessionId 聚合
   │
   └─ viewMessages → GET /api/conversations/messages?sessionId&page
        └─ 渲染聊天气泡 UI
```

---

## 九、依赖关系总览

### 9.1 小程序端依赖图

```
app.js
  └─ config/config.js
  └─ pages/* （通过 globalData 与 requireLogin 联系）

pages/index/index.js （核心对话页）
  ├─ api/zhipu.js （LLM 代理）→ wx.cloud.callFunction → processKnowledge/chat.complete
  ├─ utils/conversationManager.js （本地对话存储）
  ├─ utils/ragRetriever.js （RAG 检索）→ processKnowledge/kb.zhipu.search + rag.config.get
  ├─ utils/userInfoManager.js （用户信息）→ wechatLogin/getUser + updateProfile
  ├─ utils/markdownParser.js （Markdown → HTML）
  └─ utils/chatStreamManager.js （全局流式单例）
       └─ utils/markdownParser.js

pages/knowledge/knowledge.js
  ├─ utils/personalKB.js → processKnowledge/personal.*
  └─ utils/userInfoManager.js

pages/graph/graph.js
  ├─ components/ec-canvas/ （echarts 渲染）
  └─ wx.cloud.callFunction → processKnowledge/kb.graph.fetch

pages/login/login.js
  ├─ utils/userInfoManager.js
  └─ wx.cloud.callFunction → wechatLogin/login

pages/profile/profile.js
  ├─ utils/userInfoManager.js
  └─ wx.cloud.callFunction → feedback/submit + wechatLogin/*

components/tab-bar/tab-bar.js
  └─ utils/chatStreamManager.js （订阅流式状态）
```

### 9.2 云函数 → 外部服务

| 云函数 | 外部服务 | 端点 |
|--------|---------|------|
| processKnowledge | 智谱 BigModel | `https://open.bigmodel.cn/api/paas/v4/chat/completions`（GLM 对话） |
| processKnowledge | 智谱 BigModel | `https://open.bigmodel.cn/api/paas/v4/embeddings`（embedding-3） |
| processKnowledge | 智谱 BigModel | `https://open.bigmodel.cn/api/llm-application/open/knowledge/retrieve`（托管知识库） |
| processKnowledge | 智谱 BigModel | GLM-4V（图片 OCR） |
| processKnowledge | Neo4j Aura | `neo4j+s://` Bolt 协议 7687 端口 |
| wechatLogin | 微信开放平台 | `cloud.openapi.auth.code2Session` |
| mediaProcess | 腾讯云 ASR | （需 TENCENT_SECRET_ID/KEY） |

### 9.3 web-admin → CloudBase

`@cloudbase/node-sdk` 多策略连接，访问 `users / conversations / feedback / rag_config` 集合。

---

## 十、环境变量与配置

### 10.1 processKnowledge 云函数环境变量

| 变量 | 用途 |
|------|------|
| `ZHIPU_API_KEY` 或 `BIGMODEL_API_KEY` | 智谱 API Key（必填） |
| `ZHIPU_KNOWLEDGE_ID` | 智谱托管知识库 ID（公共知识库，必填） |
| `ZHIPU_VISION_MODEL` | 视觉模型名（默认 `glm-4v-flash`） |
| `GUEST_DAILY_LIMIT` / `GUEST_PER_MINUTE_LIMIT` | 游客每日/每分钟调用上限（默认 10/5） |
| `REGISTERED_DAILY_LIMIT` / `REGISTERED_PER_MINUTE_LIMIT` | 注册用户每日/每分钟调用上限（默认 100/10） |
| `STREAM_SHARED_SECRET` | 流式短期令牌签名密钥（与 Web 服务一致，至少 32 位） |
| `NEO4J_URI` | Neo4j Aura 连接 URI（`neo4j+s://...`） |
| `NEO4J_USERNAME` | Neo4j 用户名（默认 `neo4j`） |
| `NEO4J_PASSWORD` | Neo4j 密码 |
| `NEO4J_DATABASE` | Neo4j 数据库（默认 `neo4j`） |

### 10.2 wechatLogin 云函数

依赖微信开放平台 AppID/Secret（由云开发环境自动注入）。

### 10.3 mediaProcess 云函数

| 变量 | 用途 |
|------|------|
| `TENCENT_SECRET_ID` | 腾讯云 SecretId（ASR 用） |
| `TENCENT_SECRET_KEY` | 腾讯云 SecretKey（ASR 用） |

### 10.4 web-admin/server/.env

| 变量 | 用途 |
|------|------|
| `PORT` | 服务端口（默认 3000） |
| `JWT_SECRET` | JWT 签名密钥（必须 ≥16 位） |
| `CLOUDBASE_ENV_ID` | CloudBase 环境 ID（默认 `cloud1-6gbzplmt4a3dc5b5`） |
| `CLOUDBASE_SECRET_ID` / `CLOUDBASE_SECRET_KEY` | 腾讯云 API 密钥（与 ACCESS_KEY 二选一） |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 兜底内置管理员账号 |
| `WECHAT_APPID` / `WECHAT_SECRET` | 小程序登录配置 |
| `STREAM_SHARED_SECRET` | 验证云函数签发的短期流式令牌 |
| `CHAT_STREAM_TIMEOUT_MS` | 流式上游超时（默认 100000ms） |

---

## 十一、项目运行方式

### 11.1 准备工作

1. **Node.js**：v20.19+（推荐当前 LTS）
2. **微信开发者工具**：最新稳定版，项目基础库 3.15.2
3. **开通微信云开发**：环境 ID `cloud1-6gbzplmt4a3dc5b5`
4. **智谱 AI 账号**：获取 API Key + 创建托管知识库（记下 knowledgeId）
5. **Neo4j Aura**（可选，图谱功能）：创建数据库 + 获取 Bolt URI/credentials

### 11.2 小程序前端运行

```bash
# 安装顶层工具依赖
npm install

# 用微信开发者工具打开项目根目录
# AppID: wxc8dd14b96568bfea
# 基础库: ≥ 2.30.0
```

**关键配置修改**：

- [config/config.js](file:///c:/Users/29729/Desktop/mine/个人/go/config/config.js) — 如启用真流式，配置 `stream.serverUrl` 为线上 HTTPS 域名
- [app.js](file:///c:/Users/29729/Desktop/mine/个人/go/app.js) — 确认 `config.cloud.envId` 与实际云环境一致

### 11.3 云函数部署

**方式一：微信开发者工具上传**

- 右键 `cloudfunctions/processKnowledge` → 「上传并部署：云端安装依赖」
- 同样部署 `chatConversation / wechatLogin / feedback / mediaProcess / userConsistencyCheck`

**方式二：CloudBase CLI 脚本部署（[deploy.js](file:///c:/Users/29729/Desktop/mine/个人/go/deploy.js)）**

```bash
# 1. 安装项目依赖
npm install

# 2. 首次使用时登录腾讯云（会打开浏览器完成授权）
npx tcb login

# 3. 先检查配置，再按需部署
npm run deploy:cloud:check
npm run deploy:cloud -- processKnowledge --force

# 部署全部 6 个云函数
npm run deploy:cloud -- --all --force
```

部署配置统一记录在 `cloudbaserc.json`。该方式不需要微信小程序代码上传密钥
`private.key`；也可以通过 `CLOUDBASE_ENV_ID` 临时覆盖配置文件中的环境 ID。

**部署后配置环境变量**（云开发控制台 → 云函数 → 设置 → 环境变量，部署脚本不会写入或覆盖密钥）：

- processKnowledge：`ZHIPU_API_KEY`、`ZHIPU_KNOWLEDGE_ID`、`NEO4J_*`
- mediaProcess：`TENCENT_SECRET_ID/KEY`

**创建定时触发器**（userConsistencyCheck）：

- 云函数控制台 → 触发器 → 添加定时触发：cron `0 0 3 * * * *`（每日凌晨 3:00）

### 11.4 web-admin 后台运行

```bash
# 后端
cd web-admin/server
npm install
cp .env.example .env   # 修改 JWT_SECRET、CLOUDBASE_*、ADMIN_*
npm start              # 默认监听 PORT=3000

# 前端
cd web-admin/client
npm install
npm run dev            # 默认 5173，代理 /api → localhost:3000
```

> 后台服务、管理端代理与小程序开发配置统一使用 `localhost:3000`。

**管理员账号**：通过数据库创建，或临时使用环境变量
`ADMIN_USERNAME / ADMIN_PASSWORD` 配置；项目不提供默认口令。
首次部署可在 `web-admin/server` 配置上述变量后运行
`npm run create-admin`，创建成功后从 `.env` 删除 `ADMIN_PASSWORD`。

### 11.5 集合初始化

- `users / rag_config / conversations / feedback`：web-admin server 启动时 `ensureBusinessCollections` 自动创建
- `personal_kb_documents / personal_kb_chunks / personal_kb_history`：processKnowledge/personalKb 写入路径调用 `ensureCollection` 兜底

### 11.6 批量导入知识库（可选）

详见 [tools/README-BATCH-IMPORT.md](file:///c:/Users/29729/Desktop/mine/个人/go/tools/README-BATCH-IMPORT.md)：

```bash
# 设置 ZHIPU_API_KEY / ZHIPU_KNOWLEDGE_ID
# 把文件放入 DATA 文件夹
node tools/batch-import.js --data-dir DATA --dry-run
node tools/batch-import.js --data-dir DATA --concurrency 3
```

工具直接调用智谱官方知识库上传 API，支持格式校验、SHA-256 去重、并发上传、
网络重试、失败汇总和非零失败退出码。

---

## 十二、关键设计约束与已知问题

### 12.1 工程约定（硬约束）

| 约束 | 说明 |
|------|------|
| **模型配置自包含** | 云函数模型配置必须写在本目录 `config.js`，不依赖上级目录（部署只上传本目录） |
| **避免混合思考模型误用** | GLM-5.x 默认 max 思考响应过慢，必须配 `thinking.reasoning_effort: 'medium'` 或 `'low'` |
| **不使用 glm-4.7-flash** | 混合思考模型默认吃满 token，导致最终回答为空 |
| **统一超时预算** | 上游模型 100s、客户端 115s、processKnowledge 云端 120s，依次预留收尾时间 |
| **云函数内不重试** | 避免单次调用耗尽 120s 预算，重试逻辑放在前端并产生新的云函数调用 |
| **GLM-4.5-flash 推荐** | 平衡速度（5-10s）与质量；其他模型要么超时要么回答不完整 |
| **集合显式创建** | CloudBase 集合写入前必须存在，写路径必须 `ensureCollection()` |
| **`ensureCollection()` 定义位置** | 必须用 `async function ensureCollection(db)` 函数声明形式，定义在 imports 之后 routes 之前 |
| **Neo4j 必须用 Bolt** | Aura Free 不支持 HTTP API（403），必须 `neo4j+s://` |
| **Neo4j driver 单例** | 连接池复用，session 必须 `finally` 关闭 |
| **聚合在 DB 层** | 数据库聚合操作用 aggregate pipeline，不在内存处理 |
| **批量保存** | 消息保存用 batch 操作减少云函数调用次数 |
| **RAG 配置可前端调** | `maxChunks/maxTokens/minScore/overlap/includeMetadata/recallMethod/recallRatio/rerankStatus` 通过 web-admin 调，不硬编码 |
| **RAG 配置 5min TTL** | 云函数侧缓存 rag_config，降低 DB 压力 |
| **Markdown 富文本渲染** | AI 回答用 `<rich-text>` 组件 + 自定义 `markdownParser.js` 转 HTML，**不用原生 markdown 语法展示** |
| **流式期间用 rich-text** | 流式输出期间用 `<rich-text>` 实时 `markdownToHtml` 转换每帧，**不用 `<text>`** |

### 12.2 关键设计亮点

1. **流式输出跨页面持续**：`chatStreamManager` 单例独立于页面生命周期，切 Tab 不中断 AI 生成，tab-bar 红点指示器全局可见
2. **游客模式分级拦截**：`app.requireLogin` 统一入口，各页面 `_requireAuth` 按场景定制 purpose 文案
3. **RAG 智能联网策略**：知识库高/中匹配时不联网，无匹配或低匹配 + 时效性关键词才触发 `web_search`
4. **配置中心化**：`config/config.js` 是小程序端唯一模型配置源，切换模型只需改一行
5. **用户信息三层缓存**：内存缓存（24h TTL）→ 本地 storage → 云端，三层兜底
6. **降级与重试**：429 指数退避、网络错误重试、AI 失败兜底回复、批量保存失败降级单条
7. **自适应打字机**：首字快速 → 中段稳定 → 末段收尾，模拟真实思考节奏
8. **API Key 安全**：完全由云函数端注入环境变量，前端零暴露
9. **OPENID 信任边界**：仅接受云函数运行时的 `cloud.getWXContext().OPENID`（本地联调需显式开启开发登录），客户端不能伪造用户身份

### 12.3 审计问题处理状态（2026-07-30）

| 原问题 | 处理结果 |
|--------|----------|
| 微信路由引用未声明 axios | 已改用 Node 原生 `https` |
| Vite 代理端口与 server 不一致 | 已统一为 `3000` |
| RAG 前后端字段不一致 | 已统一契约并增加校验 |
| Feedback 绕过统一 HTTP 客户端 | 已接入统一 API 实例 |
| `/me` 重复验证且可能抛异常 | 已统一走认证中间件 |
| viewer 可执行写操作 | 后端新增 staff/admin 分层，前端同步只读态 |
| 普通小程序 JWT 可访问后台 | 后台路由统一增加 `requireStaff` |
| 云函数部署脚本调用不存在的 API | 已切换 CloudBase CLI + `cloudbaserc.json` |
| `private.key` 误提交风险 | 已加入 `.gitignore`；当前云函数部署方案不需要该文件 |
| 前端整包引入 Element Plus | 已改为按需加载，生产构建无超大 chunk 警告 |
| npm 已知安全漏洞 | 根项目、Web 前端、Web 后端审计均为 0 |

前端保留 `cloud://` URL 的防御性兜底转换；正常情况下后端已先转换为临时 HTTPS
地址，该逻辑不会重复发起云端请求。

### 12.4 设计规范参考

详见 [stitch_rag/arsenic_intelligence/DESIGN.md](file:///c:/Users/29729/Desktop/mine/个人/go/stitch_rag/arsenic_intelligence/DESIGN.md)：

- 风格：Modern Corporate + Minimalism
- 主色：深蓝 `#002045` / `#1A365D`
- 字体：Inter（数据密集场景）
- 8px 节奏间距
- 圆角：卡片 12-16px / 按钮 8px
- 阴影：L1 卡片浅阴影 → L3 模态深阴影

---

## 附录：核心文件索引

### 小程序入口与配置
- [app.js](file:///c:/Users/29729/Desktop/mine/个人/go/app.js)
- [app.json](file:///c:/Users/29729/Desktop/mine/个人/go/app.json)
- [config/config.js](file:///c:/Users/29729/Desktop/mine/个人/go/config/config.js)
- [project.config.json](file:///c:/Users/29729/Desktop/mine/个人/go/project.config.json)

### 小程序页面
- [pages/index/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/index/index.js)
- [pages/login/login.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/login/login.js)
- [pages/knowledge/knowledge.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/knowledge/knowledge.js)
- [pages/graph/graph.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/graph/graph.js)
- [pages/profile/profile.js](file:///c:/Users/29729/Desktop/mine/个人/go/pages/profile/profile.js)

### 小程序工具与代理
- [api/zhipu.js](file:///c:/Users/29729/Desktop/mine/个人/go/api/zhipu.js)
- [utils/chatStreamManager.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/chatStreamManager.js)
- [utils/conversationManager.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/conversationManager.js)
- [utils/markdownParser.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/markdownParser.js)
- [utils/personalKB.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/personalKB.js)
- [utils/ragRetriever.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/ragRetriever.js)
- [utils/userInfoManager.js](file:///c:/Users/29729/Desktop/mine/个人/go/utils/userInfoManager.js)

### 云函数 - processKnowledge
- [index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/index.js)
- [config.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/config.js)
- [handlers/chat.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/chat.js)
- [handlers/zhipuKb.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/zhipuKb.js)
- [handlers/personalKb.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/personalKb.js)
- [handlers/neo4jGraph.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/neo4jGraph.js)
- [handlers/ragConfig.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/handlers/ragConfig.js)
- [lib/db.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/db.js)
- [lib/zhipuClient.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/zhipuClient.js)
- [lib/embedding.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/embedding.js)
- [lib/fileParser.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/fileParser.js)
- [lib/textChunker.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/textChunker.js)
- [lib/vectorSearch.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/vectorSearch.js)
- [lib/ragConfig.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/processKnowledge/lib/ragConfig.js)

### 云函数 - 其他
- [chatConversation/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/chatConversation/index.js)
- [wechatLogin/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/wechatLogin/index.js)
- [feedback/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/feedback/index.js)
- [mediaProcess/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/mediaProcess/index.js)
- [userConsistencyCheck/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/cloudfunctions/userConsistencyCheck/index.js)

### Web 管理后台
- [web-admin/server/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/index.js)
- [web-admin/server/middleware/auth.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/middleware/auth.js)
- [web-admin/server/utils/cloudbase.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/utils/cloudbase.js)
- [web-admin/server/routes/auth.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/auth.js)
- [web-admin/server/routes/conversations.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/conversations.js)
- [web-admin/server/routes/feedback.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/feedback.js)
- [web-admin/server/routes/ragConfig.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/ragConfig.js)
- [web-admin/server/routes/system.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/system.js)
- [web-admin/server/routes/wechat.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/server/routes/wechat.js)
- [web-admin/client/src/main.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/src/main.js)
- [web-admin/client/src/router/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/src/router/index.js)
- [web-admin/client/src/api/index.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/src/api/index.js)
- [web-admin/client/src/stores/auth.js](file:///c:/Users/29729/Desktop/mine/个人/go/web-admin/client/src/stores/auth.js)

### 部署与工具
- [deploy.js](file:///c:/Users/29729/Desktop/mine/个人/go/deploy.js)
- [generate-avatar.js](file:///c:/Users/29729/Desktop/mine/个人/go/generate-avatar.js)
- [generate-icons.js](file:///c:/Users/29729/Desktop/mine/个人/go/generate-icons.js)
- [tools/README-BATCH-IMPORT.md](file:///c:/Users/29729/Desktop/mine/个人/go/tools/README-BATCH-IMPORT.md)
- [stitch_rag/arsenic_intelligence/DESIGN.md](file:///c:/Users/29729/Desktop/mine/个人/go/stitch_rag/arsenic_intelligence/DESIGN.md)

---

> 文档生成时间：2026-07-20
> 文档版本：v1.0
> 适用代码版本：processKnowledge v2.2.0 / chatConversation v1.0.0
