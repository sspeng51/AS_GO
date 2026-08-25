const app = getApp()
const PersonalKB = require('../../utils/personalKB')
const userInfoManager = require('../../utils/userInfoManager')

const kb = new PersonalKB()

// 文件类型 -> 图标映射
const FILE_TYPE_ICON = {
  text: '📝',
  pdf: '📄',
  doc: '📃',
  data: '🗂',
  image: '🖼',
  other: '📦'
}

Page({
  data: {
    /* —— 基础 —— */
    darkMode: false,
    activeTab: 'docs', // 'docs' | 'qa'
    userAvatarUrl: '',  // 用户头像（与首页同步）

    /* —— 统计 —— */
    stats: { documentCount: 0, chunkCount: 0, historyCount: 0 },

    /* —— 文档视图 —— */
    documents: [],
    docLoading: false,
    docError: '',         // 加载错误信息（非空时显示重试）
    docPage: 1,
    docPageSize: 20,
    docHasMore: true,
    categories: ['全部'].concat(PersonalKB.CATEGORIES),
    filterCategory: '全部',
    // 标签筛选
    availableTags: [],     // [{tag, count}]
    selectedTags: [],      // 已选标签数组
    tagMode: 'or',         // 'or' | 'and'
    tagFilterExpanded: false,

    /* —— 上传弹窗 —— */
    uploadModal: {
      show: false,
      filePath: '',
      fileName: '',
      categoryIndex: 0,
      tagsInput: '',
      uploading: false,
      progress: 0
    },

    /* —— 文档详情弹窗 —— */
    detailModal: {
      show: false,
      documentId: '',
      document: null,
      chunks: [],
      chunkPage: 1,
      chunkSize: 5,
      totalChunks: 0,
      hasMoreChunks: false,
      loading: false,
      reprocessing: false
    },

    /* —— 问答视图 —— */
    messages: [],
    qaInput: '',
    qaLoading: false,
    scrollIntoView: '',
    currentSessionId: '',   // 当前会话 ID（新对话时生成）
    showHistoryPanel: false,
    historyView: 'sessions', // 'sessions' | 'items' - 历史面板当前视图
    sessions: [],
    sessionsLoading: false,
    activeSessionId: '',     // 在历史面板中查看的会话
    history: [],
    historyLoading: false
  },

  fileTypeIcon: FILE_TYPE_ICON,

  onLoad() {
    this._initDarkMode()
    this._loadUserAvatar()
  },

  _loadUserAvatar() {
    try {
      const avatarUrl = userInfoManager.getAvatarUrl ? userInfoManager.getAvatarUrl() : ''
      this.setData({ userAvatarUrl: avatarUrl || '' })
    } catch (e) {
      // userInfoManager 未初始化时静默处理
    }
  },

  onUserAvatarError() {
    // 头像加载失败时清空，显示 fallback emoji
    this.setData({ userAvatarUrl: '' })
  },

  onShow() {
    // 每次进入刷新统计与列表
    this._loadUserAvatar()
    this.loadStats()
    if (this.data.activeTab === 'docs') {
      this.refreshDocuments()
    }
  },

  onPullDownRefresh() {
    if (this.data.activeTab === 'docs') {
      this.refreshDocuments().finally(() => wx.stopPullDownRefresh())
    } else {
      this.loadStats()
      wx.stopPullDownRefresh()
    }
  },

  onReachBottom() {
    if (this.data.activeTab === 'docs') {
      this.loadMoreDocuments()
    }
  },

  _initDarkMode() {
    const darkMode = app.globalData.darkMode || false
    this.setData({ darkMode })
  },

  onDarkModeChange(enabled) {
    this.setData({ darkMode: enabled })
  },

  // ============ Tab 切换 ============

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    if (tab === 'docs' && this.data.documents.length === 0) {
      this.refreshDocuments()
    }
    if (tab === 'qa' && this.data.history.length === 0) {
      this.loadHistory()
    }
  },

  // ============ 统计 ============

  async loadStats() {
    try {
      const stats = await kb.getStats()
      const data = { stats }
      // 同步可用标签列表
      if (stats && Array.isArray(stats.tags)) {
        data.availableTags = stats.tags
      }
      this.setData(data)
    } catch (e) {
      console.warn('[KB] 统计获取失败:', e.message || e)
    }
  },

  // ============ 文档管理 ============

  async refreshDocuments() {
    this.setData({ docLoading: true, docPage: 1, docHasMore: true, docError: '' })
    try {
      const res = await kb.listDocuments({
        page: 1,
        size: this.data.docPageSize,
        category: this.data.filterCategory,
        tags: this.data.selectedTags,
        tagMode: this.data.tagMode
      })
      const documents = (res.documents || []).map(d => ({
        ...d,
        sizeText: this._formatSize(d.size),
        icon: FILE_TYPE_ICON[d.fileType] || FILE_TYPE_ICON.other
      }))
      this.setData({
        documents,
        docHasMore: res.hasMore,
        docLoading: false,
        docError: ''
      })
    } catch (e) {
      this.setData({
        docLoading: false,
        docError: e.message || '加载失败，请检查网络后重试'
      })
    }
  },

  // 重试加载
  retryLoadDocs() {
    this.refreshDocuments()
  },

  async loadMoreDocuments() {
    if (this.data.docLoading || !this.data.docHasMore) return
    this.setData({ docLoading: true })
    try {
      const nextPage = this.data.docPage + 1
      const res = await kb.listDocuments({
        page: nextPage,
        size: this.data.docPageSize,
        category: this.data.filterCategory,
        tags: this.data.selectedTags,
        tagMode: this.data.tagMode
      })
      const more = (res.documents || []).map(d => ({
        ...d,
        sizeText: this._formatSize(d.size),
        icon: FILE_TYPE_ICON[d.fileType] || FILE_TYPE_ICON.other
      }))
      this.setData({
        documents: this.data.documents.concat(more),
        docPage: nextPage,
        docHasMore: res.hasMore,
        docLoading: false
      })
    } catch (e) {
      this.setData({ docLoading: false })
      this._toast('加载更多失败')
    }
  },

  // 标签筛选：展开/收起
  toggleTagFilter() {
    this.setData({ tagFilterExpanded: !this.data.tagFilterExpanded })
  },

  // 切换标签选中
  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    const selected = this.data.selectedTags.slice()
    const idx = selected.indexOf(tag)
    if (idx >= 0) {
      selected.splice(idx, 1)
    } else {
      selected.push(tag)
    }
    this.setData({ selectedTags: selected }, () => {
      this.refreshDocuments()
    })
  },

  // 切换 AND / OR 模式
  toggleTagMode() {
    const next = this.data.tagMode === 'or' ? 'and' : 'or'
    this.setData({ tagMode: next }, () => {
      if (this.data.selectedTags.length > 0) {
        this.refreshDocuments()
      }
    })
  },

  // 清空已选标签
  clearSelectedTags() {
    if (this.data.selectedTags.length === 0) return
    this.setData({ selectedTags: [] }, () => {
      this.refreshDocuments()
    })
  },

  filterByCategory(e) {
    const cat = e.currentTarget.dataset.cat
    if (cat === this.data.filterCategory) return
    this.setData({ filterCategory: cat }, () => {
      this.refreshDocuments()
    })
  },

  async deleteDoc(e) {
    const { id, name } = e.currentTarget.dataset
    const ok = await new Promise(resolve => {
      wx.showModal({
        title: '删除文档',
        content: `确定删除「${name}」？关联的切片与文件将一并清除。`,
        confirmColor: '#ef4444',
        success: r => resolve(r.confirm)
      })
    })
    if (!ok) return

    wx.showLoading({ title: '删除中...' })
    try {
      await kb.deleteDocument(id)
      wx.hideLoading()
      this._toast('已删除')
      this.refreshDocuments()
      this.loadStats()
    } catch (e) {
      wx.hideLoading()
      this._toast('删除失败: ' + (e.message || ''))
    }
  },

  // ============ 文档详情弹窗 ============

  async openDocDetail(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return
    this.setData({
      'detailModal.show': true,
      'detailModal.documentId': id,
      'detailModal.document': null,
      'detailModal.chunks': [],
      'detailModal.chunkPage': 1,
      'detailModal.totalChunks': 0,
      'detailModal.hasMoreChunks': false,
      'detailModal.loading': true
    })
    await this._loadDocDetailChunks(1)
  },

  async _loadDocDetailChunks(page) {
    const documentId = this.data.detailModal.documentId
    if (!documentId) return
    this.setData({ 'detailModal.loading': true })
    try {
      const res = await kb.getDocDetail({ documentId, chunkPage: page, chunkSize: this.data.detailModal.chunkSize })
      this.setData({
        'detailModal.document': {
          ...res.document,
          sizeText: this._formatSize(res.document.size),
          icon: FILE_TYPE_ICON[res.document.fileType] || FILE_TYPE_ICON.other,
          createdText: this._formatTime(res.document.createdAt)
        },
        'detailModal.chunks': res.chunks,
        'detailModal.chunkPage': res.chunkPage,
        'detailModal.totalChunks': res.totalChunks,
        'detailModal.hasMoreChunks': res.hasMoreChunks,
        'detailModal.loading': false
      })
    } catch (e) {
      this.setData({ 'detailModal.loading': false })
      this._toast('加载详情失败: ' + (e.message || ''))
    }
  },

  loadMoreChunks() {
    if (this.data.detailModal.loading || !this.data.detailModal.hasMoreChunks) return
    this._loadDocDetailChunks(this.data.detailModal.chunkPage + 1)
  },

  prevChunks() {
    if (this.data.detailModal.loading || this.data.detailModal.chunkPage <= 1) return
    this._loadDocDetailChunks(this.data.detailModal.chunkPage - 1)
  },

  closeDocDetail() {
    if (this.data.detailModal.reprocessing) {
      this._toast('重新解析中，请稍候')
      return
    }
    this.setData({ 'detailModal.show': false })
  },

  async reprocessDoc() {
    const documentId = this.data.detailModal.documentId
    if (!documentId) return
    const doc = this.data.detailModal.document
    const ok = await new Promise(resolve => {
      wx.showModal({
        title: '重新解析',
        content: `将重新下载「${(doc && doc.name || '').substring(0, 30)}」并生成切片，旧切片会被清除。继续？`,
        success: r => resolve(r.confirm)
      })
    })
    if (!ok) return

    this.setData({ 'detailModal.reprocessing': true })
    wx.showLoading({ title: '重新解析中...', mask: true })
    try {
      const res = await kb.reprocessDocument(documentId)
      wx.hideLoading()
      this.setData({ 'detailModal.reprocessing': false })
      if (res.warning) {
        wx.showModal({ title: '解析完成', content: res.warning, showCancel: false })
      } else {
        this._toast('已重新解析')
      }
      // 刷新详情与列表
      this._loadDocDetailChunks(1)
      this.refreshDocuments()
      this.loadStats()
    } catch (e) {
      wx.hideLoading()
      this.setData({ 'detailModal.reprocessing': false })
      wx.showModal({
        title: '重新解析失败',
        content: e.message || '请稍后重试',
        showCancel: false
      })
    }
  },

  // ============ 上传弹窗 ============

  openUpload() {
    this.setData({
      'uploadModal.show': true,
      'uploadModal.filePath': '',
      'uploadModal.fileName': '',
      'uploadModal.categoryIndex': 0,
      'uploadModal.tagsInput': '',
      'uploadModal.uploading': false,
      'uploadModal.progress': 0
    })
  },

  closeUpload() {
    if (this.data.uploadModal.uploading) {
      this._toast('上传中，请稍候')
      return
    }
    this.setData({ 'uploadModal.show': false })
  },

  stopPropagation() {},

  async pickFile() {
    try {
      const files = await kb.chooseMessageFile(1)
      if (!files.length) return
      const f = files[0]
      if (!kb.isSupported(f.name)) {
        this._toast('不支持该文件类型')
        return
      }
      this.setData({
        'uploadModal.filePath': f.path,
        'uploadModal.fileName': f.name
      })
    } catch (e) {
      // 用户取消等
    }
  },

  async pickImage() {
    try {
      const files = await kb.chooseImage()
      if (!files.length) return
      const f = files[0]
      this.setData({
        'uploadModal.filePath': f.path,
        'uploadModal.fileName': f.name
      })
    } catch (e) {
      // 用户取消等
    }
  },

  clearFile() {
    this.setData({
      'uploadModal.filePath': '',
      'uploadModal.fileName': ''
    })
  },

  onCategoryChange(e) {
    this.setData({ 'uploadModal.categoryIndex': Number(e.detail.value) })
  },

  onTagsInput(e) {
    this.setData({ 'uploadModal.tagsInput': e.detail.value })
  },

  async submitUpload() {
    const { filePath, fileName, categoryIndex, tagsInput, uploading } = this.data.uploadModal
    if (uploading) return
    if (!filePath || !fileName) {
      this._toast('请先选择文件')
      return
    }

    const category = PersonalKB.CATEGORIES[categoryIndex] || '其他'
    const tags = tagsInput
      .split(/[,，\s]+/)
      .map(t => t.trim())
      .filter(Boolean)

    this.setData({ 'uploadModal.uploading': true, 'uploadModal.progress': 0 })

    try {
      wx.showLoading({ title: '处理中...', mask: true })
      const result = await kb.upload({
        filePath,
        fileName,
        category,
        tags,
        onProgress: (p) => {
          this.setData({ 'uploadModal.progress': p })
        }
      })
      wx.hideLoading()
      this.setData({ 'uploadModal.show': false, 'uploadModal.uploading': false })
      if (result.warning) {
        wx.showModal({ title: '已上传', content: result.warning, showCancel: false })
      } else {
        this._toast('上传成功')
      }
      this.refreshDocuments()
      this.loadStats()
    } catch (e) {
      wx.hideLoading()
      this.setData({ 'uploadModal.uploading': false })
      wx.showModal({
        title: '上传失败',
        content: e.message || '请稍后重试',
        showCancel: false
      })
    }
  },

  // ============ 智能问答 ============

  onQaInput(e) {
    this.setData({ qaInput: e.detail.value })
  },

  async sendQuestion() {
    const question = (this.data.qaInput || '').trim()
    if (!question || this.data.qaLoading) return

    // 若无当前会话 ID，生成一个（首次提问时建立）
    let sessionId = this.data.currentSessionId
    if (!sessionId) {
      sessionId = 's_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)
      this.setData({ currentSessionId: sessionId })
    }

    const userMsg = {
      id: 'u_' + Date.now(),
      role: 'user',
      content: question,
      createdAt: Date.now()
    }
    // 取最近 4 轮作为历史
    const recentHistory = this.data.messages
      .filter(m => m.role === 'user' || m.role === 'ai')
      .slice(-8)
      .map(m => ({
        question: m.role === 'user' ? m.content : '',
        answer: m.role === 'ai' ? m.content : ''
      }))
      .reduce((acc, cur, idx, arr) => {
        // 配对 user/ai
        if (cur.question) acc.push({ question: cur.question, answer: '' })
        if (cur.answer && acc.length) acc[acc.length - 1].answer = cur.answer
        return acc
      }, [])

    this.setData({
      messages: this.data.messages.concat(userMsg),
      qaInput: '',
      qaLoading: true,
      scrollIntoView: 'msg-bottom'
    })

    // 确保 DOM 更新后滚动
    setTimeout(() => this.setData({ scrollIntoView: 'msg-bottom' }), 50)

    try {
      const res = await kb.ask({ question, history: recentHistory, sessionId })
      const aiMsg = {
        id: 'a_' + (res.historyId || Date.now()),
        role: 'ai',
        content: res.answer,
        sources: res.sources || [],
        duration: res.duration,
        createdAt: Date.now()
      }
      this.setData({
        messages: this.data.messages.concat(aiMsg),
        qaLoading: false,
        scrollIntoView: 'msg-bottom'
      })
      // 刷新统计（历史数+1）
      this.loadStats()
    } catch (e) {
      this.setData({ qaLoading: false })
      wx.showModal({
        title: '问答失败',
        content: e.message || '请稍后重试',
        showCancel: false
      })
    }
  },

  newConversation() {
    if (this.data.messages.length === 0 && !this.data.currentSessionId) {
      this._toast('已是新对话')
      return
    }
    this.setData({
      messages: [],
      qaInput: '',
      currentSessionId: ''
    })
    this._toast('已开始新对话')
  },

  // ============ 历史（会话分组） ============

  // 加载会话列表
  async loadSessions() {
    this.setData({ sessionsLoading: true })
    try {
      const res = await kb.listSessions()
      const sessions = (res.sessions || []).map(s => ({
        ...s,
        timeText: this._formatTime(s.lastTime)
      }))
      this.setData({ sessions, sessionsLoading: false })
    } catch (e) {
      this.setData({ sessionsLoading: false })
    }
  },

  // 进入某个会话，加载该会话的全部消息
  async openSession(e) {
    const sessionId = e.currentTarget.dataset.sessionId
    if (!sessionId) return
    this.setData({ activeSessionId: sessionId, historyLoading: true, historyView: 'items' })
    try {
      const res = await kb.listHistory({ page: 1, size: 100, sessionId })
      // 按时间正序展示对话
      const history = (res.history || [])
        .map(h => ({ ...h, timeText: this._formatTime(h.createdAt) }))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      this.setData({ history, historyLoading: false })
    } catch (e) {
      this.setData({ historyLoading: false })
      this._toast('加载会话失败')
    }
  },

  // 返回会话列表
  backToSessions() {
    this.setData({ historyView: 'sessions', activeSessionId: '', history: [] })
    this.loadSessions()
  },

  // 历史面板旧入口：兼容 switchTab 触发
  async loadHistory() {
    return this.loadSessions()
  },

  toggleHistoryPanel() {
    const next = !this.data.showHistoryPanel
    this.setData({ showHistoryPanel: next, historyView: 'sessions' })
    if (next && this.data.sessions.length === 0) {
      this.loadSessions()
    }
  },

  // 将某条历史加载为当前对话（继续追问）
  loadHistoryItem(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.history[idx]
    if (!item) return
    const messages = []
    if (item.question) {
      messages.push({ id: 'u_' + item.id, role: 'user', content: item.question, createdAt: 0 })
    }
    if (item.answer) {
      messages.push({
        id: 'a_' + item.id,
        role: 'ai',
        content: item.answer,
        sources: item.sources || [],
        createdAt: 0
      })
    }
    // 设为该会话的当前 sessionId，便于继续追问
    this.setData({
      messages,
      currentSessionId: item.sessionId || '',
      showHistoryPanel: false,
      scrollIntoView: 'msg-bottom'
    })
    this._toast('已加载该会话，可继续追问')
  },

  // 切换到某个会话作为当前对话（直接进入问答区）
  resumeSession(e) {
    const sessionId = e.currentTarget.dataset.sessionId
    if (!sessionId) return
    this.setData({ showHistoryPanel: false, currentSessionId: sessionId, messages: [] })
    this._toast('已切换到该会话')
    // 立即拉取该会话的全部消息显示在问答区
    this.openSessionForResume(sessionId)
  },

  async openSessionForResume(sessionId) {
    try {
      const res = await kb.listHistory({ page: 1, size: 100, sessionId })
      const msgs = []
      ;(res.history || [])
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .forEach(h => {
          if (h.question) msgs.push({ id: 'u_' + h.id, role: 'user', content: h.question, createdAt: 0 })
          if (h.answer) msgs.push({ id: 'a_' + h.id, role: 'ai', content: h.answer, sources: h.sources || [], createdAt: 0 })
        })
      this.setData({ messages: msgs, scrollIntoView: 'msg-bottom' })
    } catch (e) {
      this._toast('加载失败')
    }
  },

  async deleteHistory(e) {
    const { id } = e.currentTarget.dataset
    const ok = await new Promise(resolve => {
      wx.showModal({
        title: '删除记录',
        content: '确定删除该条问答记录？',
        confirmColor: '#ef4444',
        success: r => resolve(r.confirm)
      })
    })
    if (!ok) return
    try {
      await kb.deleteHistory(id)
      this._toast('已删除')
      // 刷新当前会话内列表
      if (this.data.activeSessionId) {
        this.openSession({ currentTarget: { dataset: { sessionId: this.data.activeSessionId } } })
      }
      this.loadStats()
    } catch (e) {
      this._toast('删除失败')
    }
  },

  async deleteSession(e) {
    const { sessionId, title } = e.currentTarget.dataset
    const ok = await new Promise(resolve => {
      wx.showModal({
        title: '删除会话',
        content: `确定删除会话「${(title || '').substring(0, 30)}」？该会话下全部问答将一并清除。`,
        confirmColor: '#ef4444',
        success: r => resolve(r.confirm)
      })
    })
    if (!ok) return
    wx.showLoading({ title: '删除中...' })
    try {
      const removed = await kb.deleteSession(sessionId)
      wx.hideLoading()
      this._toast(`已删除 ${removed} 条`)
      this.loadSessions()
      this.loadStats()
      // 若删除的是当前会话，清空问答区
      if (this.data.currentSessionId === sessionId) {
        this.setData({ messages: [], currentSessionId: '' })
      }
    } catch (e) {
      wx.hideLoading()
      this._toast('删除失败: ' + (e.message || ''))
    }
  },

  // ============ 工具 ============

  _formatSize(bytes) {
    if (!bytes) return '0 B'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  },

  _formatTime(d) {
    if (!d) return ''
    const date = new Date(d)
    if (isNaN(date.getTime())) return ''
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const md = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
    if (date.toDateString() === now.toDateString()) return hm
    return md + ' ' + hm
  },

  _toast(msg) {
    wx.showToast({ title: msg, icon: 'none', duration: 1800 })
  }
})
