const app = getApp()
const ZhipuAPI = require('../../api/zhipu')
const ConversationManager = require('../../utils/conversationManager')
const RAGRetriever = require('../../utils/ragRetriever')
const userInfoManager = require('../../utils/userInfoManager')
const { markdownToHtml } = require('../../utils/markdownParser')
const chatStreamManager = require('../../utils/chatStreamManager')
const config = require('../../config/config')
const { appendWithoutOverlap, continuationMessages } = require('../../utils/continuation')

const AUTO_CONTINUATION_LIMIT = 2

const zhipuAPI = new ZhipuAPI()
const conversationManager = new ConversationManager()
const ragRetriever = new RAGRetriever({
  topK: 8,
  baseThreshold: 0.12
})

Page({
  data: {
    inputValue: '',
    messages: [],
    groupedHistory: [],
    hasNoHistory: true,
    showSidebar: false,
    userInfo: null,
    userAvatarUrl: '',
    userDisplayName: '',
    isTyping: false,
    streamingContent: '',
    scrollToView: '',
    currentConversationId: null,
    isLoading: false,
    errorInfo: null,
    // RAG检索状态
    isRetrieving: false,
    retrievalStatus: '',
    hasKBMatch: false,
    matchQuality: '',
    // 语音/图片/文件 状态
    isRecording: false,
    recordTime: 0,
    uploadingMedia: false,
    attachments: [],          // 待发送的附件列表
    showMoreTools: false,     // 是否展开工具菜单
    isGuest: false,           // 是否游客模式
    GUEST_DAILY_LIMIT: 10,    // 游客每日免费额度
    guestRemaining: -1,       // 游客剩余次数（-1 表示已登录）
    recommendations: [],      // 推荐问题列表
    darkMode: false,          // 深色模式
  },

  // 流式输出控制（流式状态由 chatStreamManager 全局管理，这里仅保留录音等页面资源）
  _recorderManager: null,
  _recordingStartTime: 0,

  systemPrompt: `你是一个专注于“铜冶炼过程中砷的资源化利用”领域的智能问答助手，服务于铜冶炼企业、环保技术人员、科研人员及行业管理者。你的任务是提供专业、准确、易懂且安全的回答，帮助用户理解并解决与铜冶炼砷回收、处理、资源化技术及相关政策标准相关的问题。

  【知识范围】
  你主要围绕以下内容进行回答：
  1. 铜冶炼过程中砷的来源、形态与分布规律（如铜精矿伴生砷、烟尘、废酸等）。
  2. 砷的资源化技术路线：包括但不限于脱砷焙烧、湿法浸出、沉淀/结晶、砷固化稳定化、高纯砷制备、砷合金、砷化合物产品（如砷酸铜、亚砷酸钠、金属砷）等。
  3. 关键工艺环节（如电收尘、废酸处理、硫化沉淀、蒸发结晶等）及其参数控制。
  4. 环保法规、排放标准、职业健康安全要求、危险废物管理规范（如GB、HJ系列标准）。
  5. 国内外典型案例、技术经济性比较、二次废渣与废水处理、资源化产品市场方向。
  
  【回答原则】
  - **专业可靠**：基于可靠的工程实践、标准规范与公开文献，不凭空捏造数据或技术细节。
  - **清晰结构化**：对于复杂问题（如工艺流程），优先用分步骤、列表或简单流程图的方式解释。
  - **安全第一**：强调砷及其化合物的毒性、防护措施、事故应急处理建议。
  - **合规导向**：提醒用户遵循当地环保与安全法规，不鼓励任何非法排放或违规处置。
  - **实事求是**：若遇到知识范围外或不确定的问题，坦诚告知，并建议用户查阅权威标准或咨询行业专家，不尝试编造答案。
  
  【回答风格】
  - 语言简洁、专业、贴近工业现场表达（如“脱砷率”“渣含砷”“溶液pH”等）。
  - 适当使用技术术语，并对非通用术语进行简要解释。
  - 对数值类、参数类问题，尽量给出典型范围或参考来源（如“某企业实践显示……”）。
  
  【特殊情况处理】
  - 用户问及具体的设备选型或商业厂家：不推荐具体品牌，可提示关注工艺匹配性与经济评估。
  - 用户问及未经证实的技术或专利：指出目前研究阶段或信息不足，建议进一步核实。
  - 用户试图绕过安全或环保要求：明确拒绝，并重申合规与安全的重要性。
 【自动反问规则】
  - 仅当回答中信息不足以完全解决用户问题时，才在回答末尾追问一个与用户企业生产、砷处理痛点相关的问题。
  - 若回答已充分覆盖用户问题，不要强行追问，保持简洁。
  - 追问目的：引导用户提供更多背景信息（如原料含砷量、现有工艺、产能规模、环保压力、成本瓶颈等），以便后续提供更精准的建议。
  - 反问形式：自然融入对话结尾，避免生硬。
 
你的使命是推动铜冶炼砷的资源化、无害化，帮助用户用好每一克砷，将污染物转化为资源。

 【评分与反馈引导】
  - 在回答末尾，以自然、真诚的语气邀请用户为本次回答打分（1-10 分），1 分为很不满意，10 分为非常满意。
  - 同时告知用户：如有不足之处或改进建议，可通过"个人中心 - 用户反馈"提交，我们会认真对待每一条反馈。
  - 表达对用户使用与反馈的感谢，语气不要生硬或过度客套，避免每轮都机械重复，可在多轮对话中适度变化表达。
  - 格式示例（可灵活调整措辞）："希望以上内容对您有帮助～如果方便的话，请为本次回答打个分（1-10 分）；如有不足或建议，欢迎在个人中心-用户反馈中告诉我们，感谢您的支持！"`,

  onLoad() {
    this.loadUserInfo()
    this.loadConversations()
    this._updateGuestState()
    this._initDarkMode()
    
    const currentConv = conversationManager.getCurrentConversation()
    if (currentConv) {
      this.setData({
        messages: this._enrichMessages(currentConv.messages || []),
        currentConversationId: currentConv.id
      })
    } else {
      this.createNewChat()
    }
  },

  onShow() {
    this.loadUserInfo()
    this._updateGuestState()
    this._updateRecommendations()

    // 恢复进行中的流式 UI（切走再切回时，让 AI 思考状态延续）
    this._resumeStreamIfNeeded()

    // 读取来自知识库页面的待提问问题（跨 Tab 传参）
    const pending = wx.getStorageSync('_pending_ask_question')
    if (pending) {
      wx.removeStorageSync('_pending_ask_question')
      this.setData({ inputValue: pending })
      // 延迟触发，确保渲染完成；游客/额度逻辑由 sendMessage 内部处理
      setTimeout(() => {
        this.sendMessage()
      }, 300)
    }
  },

  // 切回页面时恢复流式状态：若 manager 仍在运行，把 preview 同步到 UI 并接管后续帧
  // 若 manager 已结束但 messages 残留 _streaming 标记，从 conversationManager 同步最终消息
  _resumeStreamIfNeeded() {
    const state = chatStreamManager.getState()

    if (!state.isRunning) {
      // 流式已结束：清理可能残留的 _streaming 标记（页面未被 reLaunch 销毁的情况）
      const idx = this.data.messages.findIndex(m => m._streaming)
      if (idx >= 0) {
        const conv = conversationManager.getConversation(this.data.currentConversationId)
        const finalMsg = conv && conv.messages.find(m => m.id === this.data.messages[idx].id)
        if (finalMsg) {
          this.setData({
            [`messages[${idx}]`]: this._enrichMessages([finalMsg])[0],
            isTyping: false,
            isLoading: false,
            streamingContent: ''
          })
        } else {
          this.setData({
            [`messages[${idx}]._streaming`]: false,
            [`messages[${idx}]._thinking`]: false,  // P1-2: 清除思考状态
            isTyping: false,
            isLoading: false,
            streamingContent: ''
          })
        }
      }
      return
    }

    // 流式进行中：同步当前 preview 到 UI（含实时 HTML 转换）
    const idx = this.data.messages.findIndex(m => m.id === state.aiMsgId)
    if (idx >= 0) {
      this.setData({
        [`messages[${idx}].content`]: state.preview,
        [`messages[${idx}].contentHtml`]: markdownToHtml(state.preview),
        [`messages[${idx}]._streaming`]: true,
        isTyping: true,
        isLoading: true,
        streamingContent: state.preview
      })
    }

    // 重新挂载 onProgress，让 manager 后续帧直接更新本页面
    const pageAiMsgId = state.aiMsgId
    chatStreamManager.attachProgress((preview) => {
      const i = this.data.messages.findIndex(m => m.id === pageAiMsgId)
      if (i >= 0) {
        this.setData({
          [`messages[${i}].content`]: preview,
          [`messages[${i}].contentHtml`]: markdownToHtml(preview),
          streamingContent: preview
        })
        if (preview.length % 80 < 16) {
          this._scrollToMsg(i + 1)
        }
      }
    })
  },

  onUnload() {
    // 关键：不取消 chatStreamManager 的流式任务，让 AI 思考跨页面继续
    // 只清理页面专属资源（录音等）
    if (this._unsubscribeChatStream) {
      this._unsubscribeChatStream()
      this._unsubscribeChatStream = null
    }
    if (this._recordTimer) {
      clearInterval(this._recordTimer)
      this._recordTimer = null
    }
    if (this._recorderManager) {
      try { this._recorderManager.stop() } catch (e) {}
      this._recorderManager = null
    }
  },

  loadUserInfo() {
    const info = userInfoManager.getUserInfo()
    const userId = info.userId || info.openid || ''
    this.setData({
      userInfo: info,
      userAvatarUrl: userInfoManager.getAvatarUrl(),
      userDisplayName: userInfoManager.getDisplayName()
    })
    if (userId) ragRetriever.userId = userId
    console.log(`[UserInfo] 已加载: userId=${userId.slice(0,8)}... ${info.nickName}`)
  },

  /**
   * 更新游客/登录状态到页面数据
   */
  _updateGuestState() {
    const app = getApp()
    const isGuest = app.globalData.isGuest || !app.globalData.isLoggedIn
    const guestRemaining = isGuest ? this._getGuestRemaining() : -1
    this.setData({
      isGuest: isGuest,
      guestRemaining: guestRemaining
    })
  },

  /**
   * 游客每日免费额度：10 条消息
   */
  GUEST_DAILY_LIMIT: 10,

  _getGuestRemaining() {
    const today = new Date().toISOString().slice(0, 10)
    const key = `guestMsgCount_${today}`
    const count = wx.getStorageSync(key) || 0
    return Math.max(0, this.GUEST_DAILY_LIMIT - count)
  },

  _incrementGuestCount() {
    const today = new Date().toISOString().slice(0, 10)
    const key = `guestMsgCount_${today}`
    const count = (wx.getStorageSync(key) || 0) + 1
    wx.setStorageSync(key, count)
  },

  /**
   * 更新推荐问题列表（根据对话状态动态生成）
   */
  _updateRecommendations() {
    const recs = [
      { icon: 'search', text: '铜冶炼中砷的主要来源有哪些？' },
      { icon: 'search', text: '脱砷焙烧的典型工艺参数是什么？' },
      { icon: 'search', text: '砷酸铜的制备方法与市场前景' },
      { icon: 'search', text: '含砷废渣如何固化稳定化处理？' },
      { icon: 'search', text: 'GB 25467 排放标准要求' },
    ]
    this.setData({ recommendations: recs })
  },

  /**
   * 权限校验：若为游客则弹出登录引导，返回 true 表示已登录可继续、false 表示已拦截
   * @param {string} actionName - 操作名称，用于授权说明
   * @returns {Promise<boolean>}
   */
  async _requireAuth(actionName) {
    const app = getApp()
    if (app.globalData.isLoggedIn && app.globalData.token) {
      return true
    }
    const purposeMap = {
      '语音输入': '语音输入功能需要获取您的身份信息以提供个性化服务',
      '图片上传': '上传图片需要登录账户以确保内容安全',
      '文件上传': '上传文件需要登录账户以确保内容安全',
      '提交反馈': '提交反馈需要登录账户以便我们跟进处理',
    }
    const purpose = purposeMap[actionName] || `使用「${actionName}」功能需要登录账户`
    const confirmed = await app.requireLogin('/pages/index/index', purpose)
    return false
  },

  /**
   * 游客顶部提示条的"登录"按钮
   */
  onGuestBannerLogin() {
    getApp().requireLogin('/pages/index/index', '登录后即可无限使用AI智能问答、语音输入、文件上传等全部功能')
  },

  /**
   * 初始化深色模式
   */
  _initDarkMode() {
    const app = getApp()
    this.setData({ darkMode: app.globalData.darkMode })
    if (app.globalData.darkMode) {
      try {
        wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: '#1e293b' })
        wx.setBackgroundColor({
          backgroundColor: '#0f172a', backgroundColorTop: '#0f172a', backgroundColorBottom: '#0f172a'
        })
      } catch (e) { /* ignore */ }
    }
  },

  onDarkModeChange(enabled) {
    this.setData({ darkMode: enabled })
  },

  loadConversations() {
    const conversations = conversationManager.getRecentConversations(20)
    const groups = this.groupByDate(conversations)
    
    const hasNoRecords = groups.length === 0 || !groups.some(g => g.records && g.records.length > 0)
    
    this.setData({ 
      groupedHistory: groups,
      hasNoHistory: hasNoRecords
    })
  },

  groupByDate(conversations) {
    if (!conversations || conversations.length === 0) return []

    const today = new Date().toDateString()
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toDateString()

    return [
      {
        name: '今天',
        records: conversations.filter(c => c.createdAt && new Date(c.createdAt).toDateString() === today),
        showTitle: true
      },
      {
        name: '最近 7 天',
        records: conversations.filter(c => {
          if (!c.createdAt) return false
          const date = new Date(c.createdAt).toDateString()
          return date !== today && date >= weekAgo
        }),
        showTitle: true
      },
      {
        name: '更早',
        records: conversations.filter(c => {
          if (!c.createdAt) return false
          return new Date(c.createdAt).toDateString() < weekAgo
        }),
        showTitle: true
      }
    ]
  },

  createNewChat() {
    const conversation = conversationManager.createNewConversation('新对话')
    this.setData({
      messages: [],
      currentConversationId: conversation.id,
      errorInfo: null
    })
    this.loadConversations()
  },

  // ========== 发送消息（RAG v2.0 + 流式输出） ==========
  async sendMessage() {
    const content = this.data.inputValue.trim()
    if (!content && this.data.attachments.length === 0) return
    if (this.data.isLoading) return
    // 只有新一轮发送才能清除上一次的取消状态。
    chatStreamManager.resetAbort()

    // 游客模式：每日免费额度用完则引导登录
    if (!getApp().globalData.isLoggedIn) {
      const remaining = this._getGuestRemaining()
      if (remaining <= 0) {
        await getApp().requireLogin(
          '/pages/index/index',
          '您今日的免费体验次数已用完，登录后即可无限使用AI智能问答'
        )
        return
      }
    }

    // 收集附件信息用于消息展示
    const attachments = [...this.data.attachments]

    // 构建用户消息内容
    let displayContent = content
    let messageContent = content
    const attachmentParts = []

    for (const att of attachments) {
      if (att.type === 'image') {
        attachmentParts.push(`[图片]`)
        displayContent = displayContent || '[图片]'
      } else if (att.type === 'file') {
        attachmentParts.push(`[文件] ${att.name}`)
        displayContent = displayContent || `[文件] ${att.name}`
      }
    }

    // 如果有文字，把附件信息也带上
    if (attachmentParts.length > 0 && content) {
      messageContent = `${content}\n\n${attachmentParts.join('\n')}`
    } else if (!content && attachmentParts.length > 0) {
      messageContent = attachmentParts.join('\n')
    }

    // 智谱知识库 retrieval 的 query 限制为 1000 字。附件解析出的全文仅供
    // 后续模型回答，不应拼入检索 query，否则会触发上游检索异常。
    const retrievalQuery = messageContent.substring(0, 1000)

    // 1. 添加用户消息
    const userSnapshot = userInfoManager.getUserSnapshot()
    const userMessage = {
      id: Date.now(),
      type: 'user',
      role: 'user',
      content: displayContent,
      timestamp: new Date().toLocaleTimeString(),
      userId: userSnapshot.userId,
      nickName: userSnapshot.nickName,
      avatarUrl: userSnapshot.avatarUrl,
      hasImage: attachments.some(a => a.type === 'image'),
      imageUrl: attachments.find(a => a.type === 'image')?.url,
      hasFile: attachments.some(a => a.type === 'file'),
      fileInfo: attachments.find(a => a.type === 'file')
        ? { name: attachments.find(a => a.type === 'file').name, size: attachments.find(a => a.type === 'file').size, sizeStr: attachments.find(a => a.type === 'file').sizeStr }
        : null
    }

    // 2. 创建 AI 占位消息
    const aiMsgId = Date.now() + 1
    // 记录当前正在生成的 aiMsgId，供 stopGeneration 使用
    this._currentAiMsgId = aiMsgId
    // P1-2: 优化占位提示，用更友好的"思考中"文案 + 脉冲点
    const aiPlaceholder = {
      id: aiMsgId,
      type: 'ai',
      role: 'assistant',
      content: '正在思考',
      timestamp: new Date().toLocaleTimeString(),
      sources: [],
      warning: null,
      retrievedChunks: [],
      chunksExpanded: false,
      hasKBMatch: false,
      matchQuality: '',
      usedWebSearch: false,
      webSearchInfo: null,
      _streaming: true,
      _thinking: true  // 标记为思考中状态，前端用脉冲点动画
    }

    this.setData({
      messages: [...this.data.messages, userMessage, aiPlaceholder],
      inputValue: '',
      attachments: [],
      showMoreTools: false,
      isTyping: true,
      isLoading: true,
      streamingContent: '',
      errorInfo: null,
      isRetrieving: true,
      retrievalStatus: '正在检索知识库'
    })

    conversationManager.addMessage(this.data.currentConversationId, userMessage)

    if (attachments.length > 0) {
      this.setData({ retrievalStatus: '正在解析附件' })
      const attachmentContext = await this._prepareAttachmentContext(attachments, aiMsgId)
      if (!this._isGenerationActive(aiMsgId)) return
      if (attachmentContext) {
        messageContent = `${messageContent}\n\n${attachmentContext}`.trim()
      }
    }

    // 暂存用户消息，待 AI 回答完成后批量保存（减少云函数调用次数）
    this._pendingUserContent = messageContent

    this._scrollToMsg(this.data.messages.length + 1)
    this.loadConversations()

    // 3. RAG 检索（带自适应阈值 + 重试）
    let ragContext = ''
    let retrievedChunks = []
    let hasKBMatch = false
    let matchQuality = ''
    let isKBDisabled = false

    try {
      const ragResult = await ragRetriever.retrieve(retrievalQuery, {
        kbType: 'public',
        topK: 8,
        userId: (this.data.userInfo?.userId || this.data.userInfo?.openid) || undefined
      })
      
      hasKBMatch = ragResult.hasMatch || false
      matchQuality = ragResult.matchQuality || ''
      isKBDisabled = ragResult.isDisabled === true
      retrievedChunks = this._normalizeChunks(ragResult.chunks || [])
      ragContext = ragResult.context || ''
      if (!this._isGenerationActive(aiMsgId)) return

      if (hasKBMatch && retrievedChunks.length > 0) {
        const isCrossLingual = ragResult.sourceInfo?.crossLingual || retrievedChunks[0].searchMode === 'cross_lingual_vector'
        const qualityLabels = {
          high: '高度相关',
          medium: '较为相关',
          low: '部分相关',
          very_low: '低度相关',
          minimal: '基础匹配'
        }
        const crossLingualLabel = isCrossLingual ? ' (跨语言)' : ''
        this.setData({
          retrievalStatus: `${qualityLabels[matchQuality] || ''} · ${retrievedChunks.length} 个知识块${crossLingualLabel}`,
          isRetrieving: false
        })
        console.log(`[RAG] ${qualityLabels[matchQuality] || matchQuality}: ${retrievedChunks.length} 个结果`)
      } else {
        this.setData({
          retrievalStatus: isKBDisabled ? '公共知识库检索已关闭，基于通用知识回答' : '知识库无匹配，基于通用知识回答',
          isRetrieving: false,
          hasKBMatch: false,
          matchQuality: 'no_match'
        })
        console.log(`[RAG] 无匹配 (质量=${matchQuality}, 原始结果数=${ragResult.rawResultCount || 0})`)
      }
    } catch (ragError) {
      if (!this._isGenerationActive(aiMsgId)) return
      console.warn('[RAG] 检索异常:', ragError.message)
      this.setData({
        retrievalStatus: '知识库检索不可用',
        isRetrieving: false,
        hasKBMatch: false,
        matchQuality: 'error'
      })
    }

    // 4. 更新占位消息的 RAG 元数据
    const msgIndex = this.data.messages.findIndex(m => m.id === aiMsgId)
    if (msgIndex >= 0) {
      // P1-2: 保持思考中状态，等 LLM 返回后由 chatStreamManager 接管
      this.setData({
        [`messages[${msgIndex}].content`]: hasKBMatch ? '正在生成回答' : '基于通用知识生成中',
        [`messages[${msgIndex}].retrievedChunks`]: retrievedChunks,
        [`messages[${msgIndex}].chunksExpanded`]: false,
        [`messages[${msgIndex}].hasKBMatch`]: hasKBMatch,
        [`messages[${msgIndex}].matchQuality`]: matchQuality
      })
    }

    // 5. 构建系统提示（按匹配质量分级）
    let systemPromptWithRAG
    if (hasKBMatch && ragContext) {
      const qualityGuide = {
        high: '以下知识库内容与问题高度相关。请严格基于这些内容回答，引用具体数据和结论时标注[来源N]。如知识库内容有矛盾，请指出并给出最可靠的建议。',
        medium: '以下知识库内容与问题相关。请重点参考这些内容回答，引用时标注[来源N]。如知识库内容不足以完整回答，可补充专业知识但需明确区分。',
        low: '以下知识库内容与问题部分相关。请参考并结合专业知识回答，在开头简要说明"知识库中有部分相关内容"。引用知识库内容时标注[来源N]。',
        very_low: '以下知识库内容与问题关联度较低，仅供有限参考。请主要基于专业知识回答，在开头提示"知识库匹配度较低，以下主要基于专业知识"。',
        minimal: '以下知识库内容与问题关联度很低。请以专业知识为主回答，在开头说明"知识库中暂无直接匹配内容，以下为基于专业知识的回答"。'
      }
      const guide = qualityGuide[matchQuality] || qualityGuide.low
      systemPromptWithRAG = this.systemPrompt + '\n\n' + ragContext + '\n\n' + guide
    } else {
      systemPromptWithRAG = this.systemPrompt + '\n\n' + (isKBDisabled
        ? ragRetriever.getRetrievalDisabledPrefix()
        : ragRetriever.getNoMatchPrefix())
    }

    // 保留最近 6 轮对话，避免长会话无限膨胀 prompt，导致延迟、成本和截断风险上升。
    // 当前用户消息已在 messages 中，因此切片后仍会被保留。
    const MAX_HISTORY_MESSAGES = 12
    const MAX_HISTORY_MESSAGE_CHARS = 4000
    // 当前轮可能包含 OCR 文本；它只在 messageContent 中，不在界面展示用的
    // displayContent（后者通常只是“[图片]”）。为避免模型看不到图片内容，
    // 当前消息单独保留更高的长度上限。
    const MAX_CURRENT_MESSAGE_CHARS = 12000
    // 不依赖 setData 后 this.data.messages 是否已完成同步更新：历史仅取此前消息，
    // 本轮消息始终在下方显式追加，从而保证附件 OCR 内容必定发给模型。
    const historyMessages = this.data.messages
      .filter(msg => msg.id !== userMessage.id && !(msg.type === 'ai' && msg._streaming))
      .slice(-MAX_HISTORY_MESSAGES)
      .map(msg => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: String(msg.content || '').substring(0, MAX_HISTORY_MESSAGE_CHARS)
      }))
    const apiMessageHistory = [
      { role: 'system', content: systemPromptWithRAG },
      ...historyMessages,
      {
        role: 'user',
        // 当前用户消息必须使用带附件 OCR 结果的 messageContent；界面展示用的
        // displayContent 通常只有“[图片]”或文件名，不能用于模型请求。
        content: String(messageContent || '').substring(0, MAX_CURRENT_MESSAGE_CHARS)
      }
    ]

    // 6. 调用 LLM API（带重试）
    // 智能联网策略：RAG 优先，仅当知识库无匹配/低匹配 且 问题具时效性时启用 web_search
    const useWebSearch = this._shouldUseWebSearch(messageContent, hasKBMatch, matchQuality)
    try {
      await this._callZhipuAPIStream(apiMessageHistory, aiMsgId, retrievedChunks, hasKBMatch, useWebSearch)
    } catch (error) {
      if (!this._isGenerationActive(aiMsgId)) return
      console.error('Send Message Error:', error)
      this._handleStreamError(error, aiMsgId)
    }
  },

  // ========== 智能联网判断 ==========
  // 触发联网的条件：RAG 无匹配或低匹配 + 问题含时效性/实时性特征
  // 知识库高/中匹配时不联网，保护私有知识权威性、避免无谓 token 消耗
  _shouldUseWebSearch(query, hasKBMatch, matchQuality) {
    // 知识库高度/中度相关时，信任 RAG，不联网
    if (hasKBMatch && ['high', 'medium'].includes(matchQuality)) return false

    // 兜底：无 query 时不联网
    if (!query || typeof query !== 'string') return false

    const q = query.toLowerCase()

    // 时效性/实时性关键词：时间词 + 实时数据词
    const timeWords = [
      '最新', '今天', '今日', '昨天', '近期', '最近', '目前', '现在', '当前', '此刻',
      '实时', '即时', '刚刚', '本周', '本月', '本年', '今年', '去年',
      '2024', '2025', '2026', '2027'
    ]
    const realtimeWords = [
      '股价', '汇率', '币价', '天气', '气温', '新闻', '资讯', '头条', '热搜',
      '比分', '赛果', '排行', '排行榜', '榜单', '排名', '发布', '上线', '更新',
      '公告', '政策', '法规', '标准', '版本', '价格', '行情', '指数'
    ]

    const hasTimeWord = timeWords.some(w => query.includes(w))
    const hasRealtimeWord = realtimeWords.some(w => q.includes(w.toLowerCase()))

    const shouldSearch = hasTimeWord || hasRealtimeWord
    console.log(`[WebSearch] decision: ${shouldSearch} (hasKBMatch=${hasKBMatch}, quality=${matchQuality}, timeWord=${hasTimeWord}, realtimeWord=${hasRealtimeWord})`)
    return shouldSearch
  },

  // ========== 真流式（SSE 代理） ==========
  // 尝试通过 web-admin server 的 SSE 代理真流式输出
  // 成功完成或用户取消返回 true（已自行处理 onFinish）；不可用/失败返回 false（降级）
  async _tryRealStream(messageHistory, aiMsgId, retrievedChunks, hasKBMatch, useWebSearch) {
    const self = this
    let _streamTask = null // 通过 onTask 回调捕获，供 onChunk 中 abort
    try {
      const result = await zhipuAPI.chatStream(messageHistory, {
        model: config.zhipu.model,
        webSearch: useWebSearch,
        maxTokens: 2048,
        thinkingConfig: config.zhipu.thinking,
        onTask: (task) => { _streamTask = task; chatStreamManager.setCloudTask(task) },
        onChunk: (chunk, fullContent) => {
          if (!self._isGenerationActive(aiMsgId)) {
            try { _streamTask && _streamTask.abort && _streamTask.abort() } catch (e) {}
            return
          }
          // 用户取消：中止请求
          if (chatStreamManager.isAborted()) {
            try { _streamTask && _streamTask.abort && _streamTask.abort() } catch (e) {}
            return
          }
          // 实时更新 preview（与打字机 onProgress 等价的 UI 更新）
          try {
            const idx = self.data.messages.findIndex(m => m.id === aiMsgId)
            if (idx >= 0) {
              const updates = {
                [`messages[${idx}].content`]: fullContent,
                [`messages[${idx}].contentHtml`]: markdownToHtml(fullContent),
                streamingContent: fullContent
              }
              if (self.data.messages[idx]._thinking) {
                updates[`messages[${idx}]._thinking`] = false
              }
              self.setData(updates)
              if (fullContent.length % 80 < 16) {
                self._scrollToMsg(idx + 1)
              }
            }
          } catch (e) { /* 页面已销毁，忽略 */ }
        }
      })

      chatStreamManager.clearCloudTask()
      if (!this._isGenerationActive(aiMsgId)) return true

      const recovered = await this._autoContinueResponse(messageHistory, result.content || '', result.finishReason, aiMsgId, useWebSearch)
      const fullResponse = recovered.content || '抱歉，我暂时无法回答这个问题。'
      if (recovered.incomplete) this._pendingWarning = this._incompleteWarning()

      // 提取来源（与降级路径一致）
      if (!this._pendingSources) {
        this._pendingSources = this.extractSources(fullResponse)
      }
      if (!this._pendingWarning) {
        this._pendingWarning = null
      }

      // 用户主动 abort：更新为"已停止"，不调 onFinish
      if (chatStreamManager.isAborted() || !fullResponse) {
        const msgIdx = this.data.messages.findIndex(m => m.id === aiMsgId)
        if (msgIdx >= 0) {
          const stopText = '_(生成已停止)_'
          this.setData({
            [`messages[${msgIdx}].content`]: stopText,
            [`messages[${msgIdx}].contentHtml`]: markdownToHtml(stopText),
            [`messages[${msgIdx}]._thinking`]: false,
            [`messages[${msgIdx}]._streaming`]: false,
            [`messages[${msgIdx}]._isStreaming`]: false,
            isGenerating: false,
            streamingContent: ''
          })
        }
        chatStreamManager.resetAbort()
        return true
      }

      // 复用现有 onFinish 持久化逻辑（与打字机路径完全一致）
      const sessionId = this.data.currentConversationId
      const pendingUserContent = this._pendingUserContent
      const capturedSources = this._pendingSources
      const capturedWarning = this._pendingWarning
      const capturedWebSearchInfo = null
      const capturedUseWebSearch = useWebSearch
      const capturedChunks = retrievedChunks
      const capturedHasKBMatch = hasKBMatch
      const capturedMatchQuality = (() => {
        const m = this.data.messages.find(x => x.id === aiMsgId)
        return (m && m.matchQuality) || ''
      })()

      // 清空临时状态
      this._pendingUserContent = null
      this._pendingSources = null
      this._pendingWarning = null
      this._pendingWebSearchInfo = null
      this._pendingUseWebSearch = null

      this._onStreamFinish({
        aiMsgId, sessionId,
        finalContent: fullResponse,
        wasCancelled: false,
        pendingUserContent,
        sources: capturedSources,
        warning: capturedWarning,
        webSearchInfo: capturedWebSearchInfo,
        usedWebSearch: capturedUseWebSearch,
        retrievedChunks: capturedChunks,
        hasKBMatch: capturedHasKBMatch,
        matchQuality: capturedMatchQuality
      })

      return true
    } catch (error) {
      chatStreamManager.clearCloudTask()
      if (!this._isGenerationActive(aiMsgId)) return true

      // 用户主动取消：静默返回 true（已停止）
      if (error.message === 'ABORTED' || chatStreamManager.isAborted()) {
        const msgIdx = this.data.messages.findIndex(m => m.id === aiMsgId)
        if (msgIdx >= 0) {
          const stopText = '_(生成已停止)_'
          this.setData({
            [`messages[${msgIdx}].content`]: stopText,
            [`messages[${msgIdx}].contentHtml`]: markdownToHtml(stopText),
            [`messages[${msgIdx}]._thinking`]: false,
            [`messages[${msgIdx}]._streaming`]: false,
            [`messages[${msgIdx}]._isStreaming`]: false,
            isGenerating: false,
            streamingContent: ''
          })
        }
        chatStreamManager.resetAbort()
        return true
      }

      // 已拿到的真实流内容不能丢失；降级路径会从该断点自动续答。
      this._interruptedStreamContent = error.partialContent || ''
      this._interruptedStreamReason = error.message || 'STREAM_INCOMPLETE'
      // 真流式不可用或失败：降级到云函数 + 打字机
      console.warn('[RealStream] 降级到打字机模式:', error.message)
      return false
    }
  },

  _incompleteWarning() {
    return { title: '回答未完整生成', content: '已自动续答，但仍未完成；可点击“继续生成”补齐剩余内容。' }
  },

  async _autoContinueResponse(messageHistory, initialContent, finishReason, aiMsgId, useWebSearch) {
    let content = initialContent || ''
    let reason = finishReason
    let incomplete = reason === 'length' || Boolean(this._interruptedStreamReason && content)
    this._interruptedStreamReason = null
    for (let attempt = 0; incomplete && attempt < AUTO_CONTINUATION_LIMIT; attempt++) {
      if (!this._isGenerationActive(aiMsgId) || chatStreamManager.isAborted()) break
      const idx = this.data.messages.findIndex(m => m.id === aiMsgId)
      if (idx >= 0) {
        this.setData({
          [`messages[${idx}].content`]: content || '正在继续生成…',
          [`messages[${idx}]._thinking`]: false,
          [`messages[${idx}]._streaming`]: true,
          isLoading: true,
          isTyping: true
        })
      }
      try {
        const response = await zhipuAPI.chat(continuationMessages(messageHistory, content), {
          model: config.zhipu.model,
          webSearch: useWebSearch,
          maxTokens: 2048,
          thinkingConfig: config.zhipu.thinking,
          onTask: (task) => chatStreamManager.setCloudTask(task)
        })
        chatStreamManager.clearCloudTask()
        if (!this._isGenerationActive(aiMsgId) || chatStreamManager.isAborted()) break
        content = appendWithoutOverlap(content, response.content || '')
        reason = response.finishReason
        incomplete = reason === 'length'
      } catch (error) {
        chatStreamManager.clearCloudTask()
        if (error.message === 'ABORTED' || chatStreamManager.isAborted()) break
        incomplete = true
        break
      }
    }
    return { content, incomplete: incomplete && !chatStreamManager.isAborted() }
  },

  // ========== 流式调用 API（带重试） ==========
  async _callZhipuAPIStream(messageHistory, aiMsgId, retrievedChunks = [], hasKBMatch = false, useWebSearch = false) {
    // ===== 真流式优先：通过 web-admin server SSE 代理，首字延迟 1-3s =====
    // 不支持/失败时自动降级到下方云函数 + 打字机逻辑
    const realStreamOk = await this._tryRealStream(messageHistory, aiMsgId, retrievedChunks, hasKBMatch, useWebSearch)
    if (!this._isGenerationActive(aiMsgId)) return
    if (realStreamOk) return

    let fullResponse = this._interruptedStreamContent || ''
    const hadInterruptedStream = Boolean(fullResponse)
    this._interruptedStreamContent = ''
    this._interruptedStreamReason = null
    let webSearchInfo = null
    let lastIsRateLimit = false
    let aborted = false   // 用户主动取消标记
    // P0-3: maxRetries 2 → 1，避免 60s×3=180s 叠加；总耗时上限 60s+1s+60s=121s
    const maxRetries = 1

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 限制回答长度，避免混合思考模型在云函数时限内生成过久。
        // 通过 onTask 回调暴露底层 cloud.callFunction task，供"暂停"按钮 abort
        const response = await zhipuAPI.chat(hadInterruptedStream
          ? continuationMessages(messageHistory, fullResponse)
          : messageHistory, {
          model: config.zhipu.model,
          webSearch: useWebSearch,
          maxTokens: 2048,
          thinkingConfig: config.zhipu.thinking,
          onTask: (task) => chatStreamManager.setCloudTask(task)
        })
        // 云函数返回后清除句柄（后续进入打字机阶段）
        chatStreamManager.clearCloudTask()
        if (!this._isGenerationActive(aiMsgId)) return
        fullResponse = hadInterruptedStream
          ? appendWithoutOverlap(fullResponse, response.content || '')
          : (response.content || '抱歉，我暂时无法回答这个问题。')
        webSearchInfo = response.webSearchInfo || null
        // 检测因 max_tokens 截断：提示用户可发送"继续"获取剩余内容
        const recovered = await this._autoContinueResponse(messageHistory, fullResponse, response.finishReason, aiMsgId, useWebSearch)
        fullResponse = recovered.content
        if (recovered.incomplete) this._pendingWarning = this._incompleteWarning()
        lastIsRateLimit = false
        break
      } catch (error) {
        // 云函数返回后清除句柄（无论成功失败）
        chatStreamManager.clearCloudTask()
        // 用户主动 abort：不重试，不报错，静默退出
        if (!this._isGenerationActive(aiMsgId) || error.message === 'ABORTED' || chatStreamManager.isAborted()) {
          console.log('[API] 用户主动取消生成')
          aborted = true
          break
        }
        // 检测是否为 429 频率限流
        const errMsg = (error.message || '').toLowerCase()
        lastIsRateLimit = errMsg.includes('频率超限') || errMsg.includes('429') || errMsg.includes('rate limit')
        console.error(`[API] 尝试 ${attempt + 1}/${maxRetries + 1} 失败:`, error.message, lastIsRateLimit ? '(限流)' : '')

        if (attempt < maxRetries) {
          // 指数退避：429 限流时等待更久（2s），其他错误 1s
          const waitMs = lastIsRateLimit
            ? 2000 * Math.pow(2, attempt)
            : 1000 * (attempt + 1)
          // P1-2: 重试提示保持简洁，不暴露技术细节
          const tipText = lastIsRateLimit
            ? `正在重试 (${attempt + 1}/${maxRetries})`
            : `连接中 (${attempt + 1}/${maxRetries})`

          // 更新占位消息提示重试中
          const msgIndex = this.data.messages.findIndex(m => m.id === aiMsgId)
          if (msgIndex >= 0) {
            this.setData({
              [`messages[${msgIndex}].content`]: tipText
            })
          }

          await new Promise(resolve => setTimeout(resolve, waitMs))
          if (!this._isGenerationActive(aiMsgId)) return
        } else {
          console.error('[API] 所有重试失败，使用降级响应')
          if (lastIsRateLimit) {
            // 429 限流：明确告知用户，不要给 mock 假回答
            fullResponse = '抱歉，AI 服务当前调用繁忙，请稍等几秒后重新发送您的问题。'
            this._pendingSources = []
            this._pendingWarning = 'AI 调用频率超限，建议稍后重试'
          } else {
            const mockResponse = this.getMockResponse()
            fullResponse = mockResponse.content
            this._pendingSources = mockResponse.sources || []
            this._pendingWarning = mockResponse.warning || null
          }
          // 降级路径均未实际联网，重置标记避免 UI 误显示"已联网"
          useWebSearch = false
          webSearchInfo = null
        }
      }
    }

    if (!this._isGenerationActive(aiMsgId)) return

    // 提取来源引用（若未在降级路径中设置）
    // 注意：截断警告(_pendingWarning 已设置)不应阻止 sources 提取
    if (!this._pendingSources) {
      this._pendingSources = this.extractSources(fullResponse)
    }
    if (!this._pendingWarning) {
      this._pendingWarning = null
    }

    // 用户主动 abort：直接更新消息为"已停止"，不启动打字机
    if (aborted || !fullResponse) {
      const msgIdx = this.data.messages.findIndex(m => m.id === aiMsgId)
      if (msgIdx >= 0) {
        const stopText = '_(生成已停止)_'
        this.setData({
          [`messages[${msgIdx}].content`]: stopText,
          [`messages[${msgIdx}].contentHtml`]: markdownToHtml(stopText),
          [`messages[${msgIdx}]._thinking`]: false,
          [`messages[${msgIdx}]._streaming`]: false,
          [`messages[${msgIdx}]._isStreaming`]: false,
          isGenerating: false,
          streamingContent: ''
        })
      }
      // 重置 abort 标记，下次发送可正常工作
      chatStreamManager.resetAbort()
      return
    }

    // 暂存联网搜索结果引用，供 onFinish 合并到最终消息上
    this._pendingWebSearchInfo = webSearchInfo
    this._pendingUseWebSearch = useWebSearch

    // 启动全局流式输出（独立于页面生命周期，切页面不中断）
    // 闭包捕获所有 pending 状态，避免依赖页面 this（页面可能被 reLaunch 销毁）
    const sessionId = this.data.currentConversationId
    const pendingUserContent = this._pendingUserContent
    const capturedSources = this._pendingSources
    const capturedWarning = this._pendingWarning
    const capturedWebSearchInfo = this._pendingWebSearchInfo
    const capturedUseWebSearch = this._pendingUseWebSearch === true
    const capturedChunks = retrievedChunks
    const capturedHasKBMatch = hasKBMatch
    const capturedMatchQuality = (() => {
      const m = this.data.messages.find(x => x.id === aiMsgId)
      return (m && m.matchQuality) || ''
    })()
    const self = this

    // 清空临时状态（防止下轮对话串数据）
    this._pendingUserContent = null
    this._pendingSources = null
    this._pendingWarning = null
    this._pendingWebSearchInfo = null
    this._pendingUseWebSearch = null

    chatStreamManager.startStream({
      fullText: fullResponse,
      aiMsgId,
      sessionId,
      onProgress: (preview) => {
        if (!self._isGenerationActive(aiMsgId)) return
        // 页面若还活着，更新 UI；销毁则静默跳过
        try {
          const idx = self.data.messages.findIndex(m => m.id === aiMsgId)
          if (idx >= 0) {
            // P1-2: 首帧清除 _thinking 标记，切换到流式渲染
            // 实时把 preview 转 HTML，让用户直接看到最终富文本样式
            const updates = {
              [`messages[${idx}].content`]: preview,
              [`messages[${idx}].contentHtml`]: markdownToHtml(preview),
              streamingContent: preview
            }
            if (self.data.messages[idx]._thinking) {
              updates[`messages[${idx}]._thinking`] = false
            }
            self.setData(updates)
            // 每隔约 80 字符滚动一次
            if (preview.length % 80 < 16) {
              self._scrollToMsg(idx + 1)
            }
          }
        } catch (e) { /* 页面已销毁，忽略 */ }
      },
      onFinish: (finalContent, wasCancelled) => {
        if (!self._isGenerationActive(aiMsgId)) return
        self._onStreamFinish({
          aiMsgId, sessionId, finalContent, wasCancelled,
          pendingUserContent,
          sources: capturedSources,
          warning: capturedWarning,
          webSearchInfo: capturedWebSearchInfo,
          usedWebSearch: capturedUseWebSearch,
          retrievedChunks: capturedChunks,
          hasKBMatch: capturedHasKBMatch,
          matchQuality: capturedMatchQuality
        })
      }
    })
  },

  // ========== 流式输出完成回调 ==========
  // 由 chatStreamManager 在流式结束时调用，独立于页面生命周期
  // 即使页面被 reLaunch 销毁，本方法仍会执行持久化（conversationManager + 云端）
  _onStreamFinish({ aiMsgId, sessionId, finalContent, wasCancelled, pendingUserContent, sources, warning, webSearchInfo, usedWebSearch, retrievedChunks, hasKBMatch, matchQuality }) {
    if (!this._isGenerationActive(aiMsgId)) return
    const finalSources = sources || this.extractSources(finalContent)
    const finalContentHtml = markdownToHtml(finalContent)
    if (!getApp().globalData.isLoggedIn && finalContent && !wasCancelled) {
      this._incrementGuestCount()
      this._updateGuestState()
    }

    // 1. 持久化到 conversationManager（单例，不依赖页面）
    try {
      const aiMessage = {
        id: aiMsgId,
        type: 'ai',
        role: 'assistant',
        content: finalContent,
        contentHtml: finalContentHtml,
        sources: finalSources,
        warning,
        canContinue: Boolean(warning && warning.title === '回答未完整生成'),
        retrievedChunks: retrievedChunks || [],
        chunksExpanded: false,
        hasKBMatch,
        matchQuality,
        usedWebSearch,
        webSearchInfo,
        _streaming: false,
        timestamp: new Date().toLocaleTimeString()
      }
      conversationManager.addMessage(sessionId, aiMessage)
    } catch (e) {
      console.warn('[Stream] 保存到 conversationManager 失败:', e.message)
    }

    // 2. 保存到云端（wx.cloud.callFunction，不依赖页面 UI）
    try {
      this._saveRoundToCloud(pendingUserContent, finalContent, sessionId)
    } catch (e) {
      console.warn('[Stream] 保存到云端失败:', e.message)
    }

    // 3. 更新 UI（页面若还活着；reLaunch 后旧页面销毁，setData 会失败但只打警告不抛异常）
    try {
      const msgIndex = this.data.messages.findIndex(m => m.id === aiMsgId)
      if (msgIndex >= 0) {
        const updates = {
          [`messages[${msgIndex}].content`]: finalContent,
          [`messages[${msgIndex}].contentHtml`]: finalContentHtml,
          [`messages[${msgIndex}].sources`]: finalSources,
          [`messages[${msgIndex}].warning`]: warning,
          [`messages[${msgIndex}].canContinue`]: Boolean(warning && warning.title === '回答未完整生成'),
          [`messages[${msgIndex}].usedWebSearch`]: usedWebSearch,
          [`messages[${msgIndex}].webSearchInfo`]: webSearchInfo,
          [`messages[${msgIndex}]._streaming`]: false,
          [`messages[${msgIndex}]._thinking`]: false,  // P1-2: 清除思考状态
          isTyping: false,
          isLoading: false,
          streamingContent: ''
        }
        this.setData(updates)
        this._scrollToMsg(msgIndex + 1)
      }
      this._currentAiMsgId = null
    } catch (e) {
      console.warn('[Stream] 页面已销毁，跳过 UI 更新')
    }
  },

  // 为已落库的部分回答继续生成；内部续答指令不作为用户消息保存。
  async continueGeneration(e) {
    const aiMsgId = e.currentTarget.dataset.msgId
    if (!aiMsgId || this.data.isLoading) return
    const msgIndex = this.data.messages.findIndex(m => m.id === aiMsgId)
    const current = this.data.messages[msgIndex]
    if (!current || !current.canContinue) return
    const conversation = conversationManager.getConversation(this.data.currentConversationId)
    const storedIndex = conversation && conversation.messages.findIndex(m => m.id === aiMsgId)
    const history = (conversation && storedIndex >= 0 ? conversation.messages.slice(0, storedIndex) : this.data.messages.slice(0, msgIndex))
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({ role: m.role, content: m.content }))

    this._currentAiMsgId = aiMsgId
    this.setData({
      [`messages[${msgIndex}]._streaming`]: true,
      [`messages[${msgIndex}]._thinking`]: false,
      [`messages[${msgIndex}].canContinue`]: false,
      isLoading: true,
      isTyping: true
    })
    const recovered = await this._autoContinueResponse(history, current.content, 'length', aiMsgId, current.usedWebSearch === true)
    if (!this._isGenerationActive(aiMsgId) || chatStreamManager.isAborted()) return
    const finalContent = recovered.content
    const warning = recovered.incomplete ? this._incompleteWarning() : null
    const finalMessage = {
      ...current,
      content: finalContent,
      contentHtml: markdownToHtml(finalContent),
      warning,
      canContinue: Boolean(warning),
      _streaming: false,
      _thinking: false
    }
    if (conversation && storedIndex >= 0) {
      conversation.messages[storedIndex] = finalMessage
      conversationManager.updateConversation(conversation.id, conversation)
    }
    this.setData({
      [`messages[${msgIndex}]`]: finalMessage,
      isLoading: false,
      isTyping: false,
      streamingContent: ''
    })
    this._currentAiMsgId = null
  },

  // 给历史 AI 消息补上 contentHtml 字段（首次加载或切换历史会话时调用）
  // 流式中的消息跳过，避免重复解析和不必要的 setData
  _enrichMessages(messages) {
    if (!Array.isArray(messages)) return messages
    return messages.map(m => {
      if (m && m.type === 'ai' && !m._streaming && !m.contentHtml && m.content) {
        return { ...m, contentHtml: markdownToHtml(m.content) }
      }
      return m
    })
  },

  // ========== 保存消息到云端 ==========

  /**
   * 批量保存一轮对话（用户消息 + AI 回答）到云端
   * 将原本的 2 次云函数调用合并为 1 次
   */
  _saveRoundToCloud(userContent, aiContent, conversationId) {
    const snapshot = userInfoManager.getUserSnapshot()
    const userId = snapshot.userId || 'anonymous'
    const sessionId = String(conversationId || this.data.currentConversationId || '').trim()
    if (!sessionId) return
    const now = new Date().toISOString()
    const meta = { nickName: snapshot.nickName, avatarUrl: snapshot.avatarUrl }

    const messages = []
    if (userContent) {
      messages.push({ direction: 'user', content: userContent, messageType: 'text', metadata: meta, timestamp: now })
    }
    if (aiContent) {
      messages.push({ direction: 'ai', content: aiContent, messageType: 'text', metadata: meta, timestamp: now })
    }
    if (messages.length === 0) return

    const payload = {
      action: 'chat.saveMessages',
      data: { userId, sessionId, messages }
    }

    this._callCloudWithRetry('processKnowledge', payload, 2)
      .then(res => {
        if (res?.success) {
          console.log(`[Sync] 本轮对话已批量保存 saved=${res.saved || messages.length}`)
        } else {
          console.warn('[Sync] 批量保存失败:', res?.error || '未知错误')
          // 批量失败时降级为单条保存，避免丢失
          messages.forEach(m => this._logSyncError(m.direction, m.content, res?.error))
        }
      })
      .catch(err => {
        console.warn('[Sync] 批量保存异常:', err.message)
        messages.forEach(m => this._logSyncError(m.direction, m.content, err.message))
      })
  },

  _saveMessageToCloud(content, direction) {
    const snapshot = userInfoManager.getUserSnapshot()
    const userId = snapshot.userId || 'anonymous'
    const sessionId = String(this.data.currentConversationId || '').trim()
    if (!sessionId) return

    const payload = {
      action: 'chat.saveMessage',
      data: {
        userId,
        sessionId,
        direction,
        content,
        messageType: 'text',
        metadata: { nickName: snapshot.nickName, avatarUrl: snapshot.avatarUrl }
      }
    }

    this._callCloudWithRetry('processKnowledge', payload, 2)
      .then(res => {
        if (res?.success) {
          console.log(`[Sync] ${direction === 'user' ? '用户消息' : 'AI回答'}已保存 cloudId=${userId.slice(0,8)}...`)
        } else {
          console.warn(`[Sync] 保存失败:`, res?.error || '未知错误')
          this._logSyncError(direction, content, res?.error)
        }
      })
      .catch(err => {
        console.warn(`[Sync] 保存异常:`, err.message)
        this._logSyncError(direction, content, err.message)
      })
  },

  async _prepareAttachmentContext(attachments, aiMsgId) {
    const limited = (attachments || []).slice(0, 3)
    const sections = []
    let failedCount = 0
    for (const attachment of limited) {
      if (aiMsgId && !this._isGenerationActive(aiMsgId)) break
      try {
        const response = await wx.cloud.callFunction({
          name: 'processKnowledge',
          data: {
            action: 'chat.attachment.extract',
            data: {
              fileID: attachment.url,
              fileName: attachment.name,
              type: attachment.type
            }
          }
        })
        const result = response && response.result
        if (result && result.success && result.text) {
          const name = result.fileName || attachment.name
          const isImage = attachment.type === 'image' || /\.(png|jpe?g|gif|bmp|webp)$/i.test(name || '')
          // 明确告诉文本模型：它收到的是已完成的图片解析结果，避免模型只因
          // 消息中含有“图片”一词就回答“无法查看图片”。
          const label = isImage ? '已解析图片（OCR / 内容描述）' : '已解析附件'
          sections.push(`【${label}：${name}】\n请根据以下已提取内容回答用户，不要声称无法查看该图片或附件。\n${result.text}`)
        } else {
          failedCount += 1
          console.warn('[Attachment] 解析失败:', result?.error || '未知错误')
          sections.push(`【附件：${attachment.name}】\n（解析失败：${result?.error || '未知错误'}）`)
        }
      } catch (error) {
        failedCount += 1
        console.warn('[Attachment] 调用失败:', error.message)
        sections.push(`【附件：${attachment.name}】\n（解析失败，请根据用户文字继续回答）`)
      }
    }
    if (failedCount > 0 && (!aiMsgId || this._isGenerationActive(aiMsgId))) {
      wx.showToast({ title: '图片或附件解析失败', icon: 'none' })
    }
    if ((attachments || []).length > limited.length) {
      sections.push(`（本次最多解析 3 个附件，其余 ${(attachments || []).length - limited.length} 个未解析）`)
    }
    return sections.join('\n\n')
  },

  /**
   * 带重试的云函数调用
   */
  _callCloudWithRetry(name, data, maxRetries = 2) {
    return new Promise((resolve, reject) => {
      const attempt = (retryLeft) => {
        wx.cloud.callFunction({ name, data })
          .then(res => {
            if (res.result?.success || retryLeft <= 0) {
              resolve(res.result || {})
            } else {
              console.warn(`[Sync] 重试 (${maxRetries - retryLeft + 1}/${maxRetries})...`)
              setTimeout(() => attempt(retryLeft - 1), 1000)
            }
          })
          .catch(err => {
            if (retryLeft > 0) {
              console.warn(`[Sync] 网络异常，重试 (${maxRetries - retryLeft + 1}/${maxRetries})...`)
              setTimeout(() => attempt(retryLeft - 1), 1500)
            } else {
              reject(err)
            }
          })
      }
      attempt(maxRetries)
    })
  },

  /**
   * 记录同步失败日志（用于后续排查）
   */
  _logSyncError(direction, content, error) {
    try {
      const logs = wx.getStorageSync('_sync_error_logs') || []
      logs.push({
        time: new Date().toISOString(),
        direction,
        contentPreview: (content || '').substring(0, 100),
        error: error || 'unknown'
      })
      if (logs.length > 50) logs.splice(0, logs.length - 50)
      wx.setStorageSync('_sync_error_logs', logs)
    } catch (_) { /* storage full, ignore */ }
  },

  // ========== 流式错误处理 ==========
  _handleStreamError(error, aiMsgId) {
    const msgIndex = this.data.messages.findIndex(m => m.id === aiMsgId)
    let errorContent = '抱歉，服务暂时不可用，请稍后重试。'

    if (error.message && error.message.includes('timeout')) {
      errorContent = '请求超时，请检查网络后重试。'
    }

    if (msgIndex >= 0) {
      this.setData({
        [`messages[${msgIndex}].content`]: errorContent,
        [`messages[${msgIndex}].contentHtml`]: markdownToHtml(errorContent),
        [`messages[${msgIndex}]._streaming`]: false,
        [`messages[${msgIndex}]._thinking`]: false,  // P1-2: 清除思考状态
        [`messages[${msgIndex}].sources`]: [],
        [`messages[${msgIndex}].warning`]: null,
        [`messages[${msgIndex}].usedWebSearch`]: false,
        [`messages[${msgIndex}].webSearchInfo`]: null,
        isTyping: false,
        isLoading: false,
        errorInfo: { message: errorContent, time: new Date() }
      })
    } else {
      this.setData({
        isTyping: false,
        isLoading: false,
        errorInfo: { message: errorContent, time: new Date() }
      })
    }

    // 清除联网搜索临时状态
    this._pendingWebSearchInfo = null
    this._pendingUseWebSearch = null

    // AI 生成失败时，单独保存暂存的用户消息，避免丢失
    if (this._pendingUserContent) {
      const pending = this._pendingUserContent
      this._pendingUserContent = null
      this._saveMessageToCloud(pending, 'user')
    }
  },

  // ========== 语音输入 ==========
  onVoiceStart() {
    if (this.data.isLoading || this.data.isRecording) return

    // 游客模式：语音输入需要登录
    if (!getApp().globalData.isLoggedIn) {
      this._requireAuth('语音输入')
      return
    }

    // 初始化录音管理器
    if (!this._recorderManager) {
      this._recorderManager = wx.getRecorderManager()
      this._recorderManager.onStop((res) => {
        this._onRecordStop(res)
      })
      this._recorderManager.onError((err) => {
        console.error('[Voice] 录音错误:', err)
        this.setData({ isRecording: false, recordTime: 0 })
        wx.showToast({ title: '录音失败，请重试', icon: 'none' })
      })
    }

    this._recordingStartTime = Date.now()
    this.setData({ isRecording: true, recordTime: 0 })

    // 更新录音时长
    this._recordTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this._recordingStartTime) / 1000)
      this.setData({ recordTime: elapsed })
      if (elapsed >= 60) {
        this.onVoiceEnd()
      }
    }, 500)

    this._recorderManager.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    })

    wx.showToast({ title: '开始录音...', icon: 'none', duration: 1000 })
  },

  onVoiceEnd() {
    if (!this.data.isRecording) return
    if (this._recordTimer) {
      clearInterval(this._recordTimer)
      this._recordTimer = null
    }
    this._recorderManager && this._recorderManager.stop()
    this.setData({ isRecording: false })
  },

  async _onRecordStop(res) {
    const { tempFilePath, duration } = res
    if (!tempFilePath) {
      wx.showToast({ title: '录音文件为空', icon: 'none' })
      return
    }
    if (duration < 1000) {
      wx.showToast({ title: '录音时间太短', icon: 'none' })
      return
    }

    wx.showLoading({ title: '语音识别中...' })

    try {
      // 上传音频到云存储
      const ownerId = this._getAttachmentOwnerSegment()
      if (!ownerId) throw new Error('用户身份信息缺失，请重新登录')
      const cloudPath = `voice/${ownerId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath
      })

      // 调用云函数进行语音识别
      const asrRes = await wx.cloud.callFunction({
        name: 'mediaProcess',
        data: {
          action: 'speechToText',
          data: { fileID: uploadRes.fileID }
        }
      })

      wx.hideLoading()

      if (asrRes.result?.success && asrRes.result.text) {
        // 将识别文字追加到输入框
        const currentText = this.data.inputValue
        const newText = currentText ? currentText + asrRes.result.text : asrRes.result.text
        this.setData({ inputValue: newText })
        wx.showToast({ title: '识别完成', icon: 'success', duration: 1500 })
      } else {
        wx.showToast({
          title: asrRes.result?.error || '语音识别未配置',
          icon: 'none',
          duration: 2000
        })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('[Voice] 识别失败:', err)
      wx.showToast({ title: '语音识别失败', icon: 'none' })
    }
  },

  // ========== 拍照 / 相册（添加为附件） ==========
  onCamera() {
    this._pickAndUploadImage('camera', '拍摄照片')
  },

  onChooseImage() {
    this._pickAndUploadImage('album', '图片')
  },

  _pickAndUploadImage(sourceType, label) {
    if (this.data.isLoading) return

    // 游客模式：上传图片需要登录
    if (!getApp().globalData.isLoggedIn) {
      this._requireAuth('图片上传')
      return
    }

    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: [sourceType],
      success: async (res) => {
        const tempFilePath = res.tempFilePaths[0]
        if (!tempFilePath) return

        wx.showLoading({ title: '上传图片...' })

        try {
          const ownerId = this._getAttachmentOwnerSegment()
          if (!ownerId) throw new Error('用户身份信息缺失，请重新登录')
          const cloudPath = `chat-attachments/${ownerId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
          const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath })
          wx.hideLoading()

          this.setData({
            attachments: [...this.data.attachments, { id: Date.now(), type: 'image', url: uploadRes.fileID, name: `${label}.jpg` }],
            showMoreTools: false
          })
        } catch (err) {
          wx.hideLoading()
          console.error(`[${sourceType}] 上传失败:`, err)
          wx.showToast({ title: '图片上传失败', icon: 'none' })
        }
      }
    })
  },

  // ========== 文件上传（添加为附件） ==========
  onChooseFile() {
    if (this.data.isLoading) return

    // 游客模式：上传文件需要登录
    if (!getApp().globalData.isLoggedIn) {
      this._requireAuth('文件上传')
      return
    }

    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: async (res) => {
        const file = res.tempFiles[0]
        if (!file) return

        let filePath = file.tempFilePath || file.path
        if (!filePath) {
          wx.showToast({ title: '无法读取该文件', icon: 'none' })
          return
        }

        // 10MB 限制
        if (file.size > 10 * 1024 * 1024) {
          wx.showToast({ title: '文件不能超过10MB', icon: 'none' })
          return
        }

        wx.showLoading({ title: '上传文件...' })

        try {
          const ownerId = this._getAttachmentOwnerSegment()
          if (!ownerId) throw new Error('用户身份信息缺失，请重新登录')
          const safeFileName = String(file.name || 'attachment')
            .replace(/[\\/\0]/g, '_')
            .substring(0, 120)
          const cloudPath = `chat-attachments/${ownerId}/${Date.now()}_${safeFileName}`
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath: filePath
          })

          wx.hideLoading()

          const sizeStr = file.size > 1024 * 1024
            ? (file.size / 1024 / 1024).toFixed(1) + 'MB'
            : (file.size / 1024).toFixed(1) + 'KB'

          // 添加到附件列表
          const newAttachment = {
            id: Date.now(),
            type: 'file',
            url: uploadRes.fileID,
            name: file.name,
            size: file.size,
            sizeStr
          }

          this.setData({
            attachments: [...this.data.attachments, newAttachment],
            showMoreTools: false
          })
        } catch (err) {
          wx.hideLoading()
          console.error('[File] 上传失败:', err)
          wx.showToast({ title: '文件上传失败', icon: 'none' })
        }
      },
      fail(err) {
        console.warn('[File] 选择文件取消或失败:', err)
      }
    })
  },

  _getAttachmentOwnerSegment() {
    const info = userInfoManager.getUserInfo()
    return String(info.userId || info.openid || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_')
  },

  // ========== 附件操作 ==========
  toggleMoreTools() {
    this.setData({ showMoreTools: !this.data.showMoreTools })
  },

  onRemoveAttachment(e) {
    const id = e.currentTarget.dataset.id
    this.setData({
      attachments: this.data.attachments.filter(a => a.id !== id)
    })
  },

  

  // ========== 停止生成 ==========
  // 直接处理 UI 更新 + 中止请求，不依赖回调链（abort 后 fail 回调可能不触发）
  stopGeneration() {
    const aiMsgId = this._currentAiMsgId

    // 先使本轮请求失效；即便云函数无法真正取消，迟到结果也不能再写回 UI。
    this._currentAiMsgId = null
    // 1. 中止底层请求（云函数 callFunction 或打字机 setTimeout）
    chatStreamManager.cancel()

    // 2. 立即更新 UI（不等待 fail 回调，避免按钮无响应）
    if (aiMsgId) {
      const idx = this.data.messages.findIndex(m => m.id === aiMsgId)
      if (idx >= 0) {
        const currentContent = this.data.messages[idx].content || ''
        // 已有内容（打字机阶段）则保留 + 追加"已停止"；无内容（等云函数阶段）则显示"已停止"
        const stopText = (currentContent && currentContent !== '正在思考')
          ? currentContent + '\n\n_（生成已停止）_'
          : '_（生成已停止）_'
        this.setData({
          [`messages[${idx}].content`]: stopText,
          [`messages[${idx}].contentHtml`]: markdownToHtml(stopText),
          [`messages[${idx}]._thinking`]: false,
          [`messages[${idx}]._streaming`]: false,
          [`messages[${idx}]._isStreaming`]: false,
          isLoading: false,
          isTyping: false,
          isRetrieving: false,
          streamingContent: ''
        })
      }
    } else {
      // 兜底：重置所有生成状态
      this.setData({
        isLoading: false,
        isTyping: false,
        isRetrieving: false,
        streamingContent: ''
      })
    }

    // abort 标记由下一次 sendMessage 开始时重置，避免迟到响应被误判为有效。
  },

  _isGenerationActive(aiMsgId) {
    return Boolean(aiMsgId) && this._currentAiMsgId === aiMsgId
  },

  // ========== 图片预览 ==========
  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    if (url) {
      wx.previewImage({
        urls: [url],
        current: url
      })
    }
  },

  /**
   * API 调用失败时的降级响应（最终兜底）
   */
  getMockResponse() {
    return {
      content: '抱歉，当前网络连接异常，暂时无法获取回答。请检查网络后重试，或稍后再试。\n\n您也可以尝试：\n1. 切换网络环境\n2. 重新输入问题\n3. 以更简洁的方式描述您的问题',
      sources: [],
      warning: '网络异常，显示的是兜底回复，请稍后重试'
    }
  },

  /**
   * 从回答内容中提取参考来源
   */
  extractSources(content) {
    if (!content) return []
    const sources = []
    // 匹配标准编号（如 GB 25467、HJ 557）
    const stdMatches = content.match(/(?:GB|HJ|DB)\s?\d{4,}(?:\.\d+)?/g)
    if (stdMatches) {
      const unique = [...new Set(stdMatches)]
      unique.forEach(std => {
        sources.push({ title: std + ' 标准规范' })
      })
    }
    // 匹配"某企业""某厂"等案例引用
    if (content.includes('企业实践') || content.includes('某企业') || content.includes('某厂') || content.includes('案例')) {
      sources.push({ title: '行业典型案例' })
    }
    // 匹配国际标准
    if (content.includes('WHO') || content.includes('EPA') || content.includes('ISO')) {
      sources.push({ title: '国际标准/指南' })
    }
    return sources
  },
  _scrollToMsg(msgIndex) {
    setTimeout(() => {
      this.setData({
        scrollToView: 'msg-' + msgIndex
      })
    }, 50)
  },

  scrollToBottom() {
    setTimeout(() => {
      const length = this.data.messages.length
      if (length > 0) {
        this.setData({
          scrollToView: 'msg-' + length
        })
      }
    }, 100)
  },

  // ========== 侧边栏 ==========
  toggleSidebar() {
    this.setData({
      showSidebar: !this.data.showSidebar
    })
  },

  closeSidebar() {
    this.setData({
      showSidebar: false
    })
  },

  stopPropagation() {},

  // ========== 历史记录 ==========
  onHistoryItemTap(e) {
    const item = e.currentTarget.dataset.item
    if (item && item.id) {
      this.switchToConversation(item.id)
    }
    this.closeSidebar()
  },

  switchToConversation(conversationId) {
    const conversation = conversationManager.getConversation(conversationId)
    if (!conversation) return

    conversationManager.setCurrentConversation(conversationId)
    
    this.setData({
      messages: this._enrichMessages(conversation.messages || []),
      currentConversationId: conversationId,
      errorInfo: null
    })
  },

  clearHistory() {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有历史记录吗？此操作不可恢复。',
      success: (res) => {
        if (res.confirm) {
          conversationManager.clearAllConversations()
          this.setData({
            groupedHistory: [],
            messages: [],
            currentConversationId: null,
            hasNoHistory: true
          })
          this.createNewChat()
          wx.showToast({
            title: '已清空所有记录',
            icon: 'success'
          })
        }
      }
    })
  },

  deleteSingleHistory(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    
    wx.showModal({
      title: '删除对话',
      content: '确定删除该对话吗？',
      success: (res) => {
        if (res.confirm) {
          conversationManager.deleteConversation(id)
          
          if (id === this.data.currentConversationId) {
            this.createNewChat()
          }
          
          this.loadConversations()
          wx.showToast({
            title: '已删除',
            icon: 'success'
          })
        }
      }
    })
  },

  // ========== 输入与交互 ==========
  onInputChange(e) {
    this.setData({
      inputValue: e.detail.value
    })
  },

  onRecommendationTap(e) {
    const text = e.currentTarget.dataset.text
    if (text) {
      this.setData({
        inputValue: text
      })
      this.sendMessage()
    }
  },

  onThumbUp(e) {
    this._submitRating(e, 'up', '👍 好评', '感谢反馈')
  },

  onThumbDown(e) {
    this._submitRating(e, 'down', '👎 差评', '我们会改进')
  },

  _submitRating(e, direction, label, successMsg) {
    const { index, msgId } = e.currentTarget.dataset
    const msg = this.data.messages[index]
    if (!msg || msg._rated) return

    // 游客模式：提交反馈需要登录
    if (!getApp().globalData.isLoggedIn) {
      this._requireAuth('提交反馈')
      return
    }

    const snapshot = userInfoManager.getUserSnapshot()
    const content = `[${label}] 对话ID: ${msgId}\n问题: ${this._getPrevUserMsg(index)}\n回答: ${msg.content.substring(0, 500)}`

    this.setData({ [`messages[${index}]._rated`]: direction })

    wx.cloud.callFunction({
      name: 'feedback',
      data: {
        action: 'submit',
        data: { userId: snapshot.userId, nickName: snapshot.nickName, avatarUrl: snapshot.avatarUrl, content, category: 'rating', contact: '' }
      }
    }).then(res => {
      if (res.result?.success) {
        wx.showToast({ title: successMsg, icon: direction === 'up' ? 'success' : 'none' })
      } else {
        this.setData({ [`messages[${index}]._rated`]: '' })
        console.warn('[Feedback] 提交失败:', res.result?.error)
        wx.showToast({ title: res.result?.error || '提交失败，请重试', icon: 'none' })
      }
    }).catch(err => {
      this.setData({ [`messages[${index}]._rated`]: '' })
      console.error('[Feedback] 调用异常:', err)
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
    })
  },

  // 获取当前AI消息对应的上一条用户消息
  _getPrevUserMsg(aiIndex) {
    for (let i = aiIndex - 1; i >= 0; i--) {
      if (this.data.messages[i] && this.data.messages[i].type === 'user') {
        return this.data.messages[i].content.substring(0, 300)
      }
    }
    return '(无)'
  },

  // 头像加载失败时显示默认图标
  onUserAvatarError(e) {
    const index = e.currentTarget.dataset.index
    if (index !== undefined) {
      this.setData({ [`messages[${index}].avatarUrl`]: '' })
    }
  },

  copyContent(e) {
    const content = e.currentTarget.dataset.content
    if (content) {
      wx.setClipboardData({
        data: content,
        success: () => {
          wx.showToast({ title: '已复制', icon: 'success' })
        }
      })
    }
  },

  onSourceTap(e) {
    const source = e.currentTarget.dataset.source
    if (source && source.title) {
      wx.showToast({
        title: '查看：' + source.title,
        icon: 'none'
      })
    }
  },

  // ========== RAG检索内容展开/折叠 ==========
  _normalizeChunks(chunks) {
    if (!chunks || !Array.isArray(chunks)) return []
    return chunks.map(chunk => ({
      ...chunk,
      scorePercent: Math.round((chunk.score || 0) * 100),
      scoreWidth: Math.max(0, Math.min(100, Math.round((chunk.score || 0) * 100))),
      searchMode: chunk.searchMode === 'cross_lingual_vector' ? 'cross_lingual_vector' : (chunk.searchMode || 'vector')
    }))
  },

  toggleChunksExpand(e) {
    const msgId = e.currentTarget.dataset.msgId
    const msgIndex = this.data.messages.findIndex(m => m.id === msgId)
    if (msgIndex >= 0) {
      const currentExpanded = this.data.messages[msgIndex].chunksExpanded
      this.setData({
        [`messages[${msgIndex}].chunksExpanded`]: !currentExpanded
      })
    }
  },

  onChunkTap(e) {
    const chunk = e.currentTarget.dataset.chunk
    if (chunk && chunk.content) {
      wx.showModal({
        title: chunk.title || '知识块内容',
        content: chunk.content.length > 800 
          ? chunk.content.substring(0, 800) + '...' 
          : chunk.content,
        showCancel: false,
        confirmText: '关闭'
      })
    }
  }
})
