const app = getApp()
const userInfoManager = require('../../utils/userInfoManager')

Page({
  data: {
    // 用户信息
    userInfo: {
      avatarUrl: '',
      nickName: '微信用户',
      openid: '',
      title: '砷智答用户',
      role: '用户',
      bio: '科学知识探索者',
      phone: '未绑定',
      email: '未绑定'
    },

    // 深色模式
    darkMode: false,

    // 缓存大小
    cacheSize: '0 MB',

    // 编辑资料弹窗
    showEditModal: false,
    editForm: {
      avatarUrl: '',
      nickName: '',
      bio: '',
      title: '',
      phone: '',
      email: ''
    },

    // 反馈弹窗
    showFeedbackModal: false,
    feedbackContent: '',
    feedbackContact: '',
    feedbackCategory: 'general',
    feedbackScore: 0,
    feedbackSubmitting: false
  },

  onLoad() {
    this.loadUserInfo()
    this.loadPreferences()
    this.calcCacheSize()
    this._updateGuestState()
  },

  onShow() {
    this.loadUserInfo()
    this._updateGuestState()
    // 同步全局深色模式状态
    const appDark = getApp().globalData.darkMode
    this.setData({ darkMode: appDark })
    this._setPageDarkClass(appDark)
  },

  /**
   * 更新游客/登录状态到页面数据
   */
  _updateGuestState() {
    const app = getApp()
    this.setData({
      isGuest: app.globalData.isGuest || !app.globalData.isLoggedIn
    })
  },

  /**
   * 游客引导登录
   */
  onGuestLogin() {
    const app = getApp()
    app.requireLogin('/pages/profile/profile', '登录后可查看个人信息、编辑资料和使用全部功能')
  },

  // 云端刷新节流时间戳（5 分钟内不重复刷新，减少云函数调用）
  _lastCloudRefreshAt: 0,
  _CLOUD_REFRESH_INTERVAL: 5 * 60 * 1000,

  /* ========== 数据加载 ========== */

  loadUserInfo() {
    const stored = wx.getStorageSync('userInfo')
    const appUserInfo = app.globalData.userInfo

    // 优先使用 globalData，其次 storage
    const info = appUserInfo || stored

    if (info) {
      this.setData({
        'userInfo.avatarUrl': info.avatarUrl || this.data.userInfo.avatarUrl,
        'userInfo.nickName': info.nickName || this.data.userInfo.nickName,
        'userInfo.openid': info.openid || this.data.userInfo.openid,
        'userInfo.title': info.title || stored?.title || this.data.userInfo.title,
        'userInfo.bio': info.bio || stored?.bio || this.data.userInfo.bio,
        'userInfo.phone': info.phone || stored?.phone || this.data.userInfo.phone,
        'userInfo.email': info.email || stored?.email || this.data.userInfo.email,
        'userInfo.role': info.role || stored?.role || this.data.userInfo.role
      })
    }

    // 异步刷新云端最新数据，节流：5 分钟内不重复刷新
    const now = Date.now()
    if (now - this._lastCloudRefreshAt < this._CLOUD_REFRESH_INTERVAL) {
      return
    }
    this._lastCloudRefreshAt = now

    userInfoManager.refreshFromCloud().then(cloudInfo => {
      if (cloudInfo) {
        this.setData({
          'userInfo.avatarUrl': cloudInfo.avatarUrl || this.data.userInfo.avatarUrl,
          'userInfo.nickName': cloudInfo.nickName || this.data.userInfo.nickName,
          'userInfo.openid': cloudInfo.openid || this.data.userInfo.openid,
          'userInfo.title': cloudInfo.title || this.data.userInfo.title,
          'userInfo.bio': cloudInfo.bio || this.data.userInfo.bio,
          'userInfo.phone': cloudInfo.phone || this.data.userInfo.phone,
          'userInfo.email': cloudInfo.email || this.data.userInfo.email,
          'userInfo.role': cloudInfo.role || this.data.userInfo.role
        })
      }
    }).catch(() => {})
  },

  loadPreferences() {
    const darkMode = wx.getStorageSync('darkMode')
    if (darkMode !== '') {
      this.setData({ darkMode: !!darkMode })
      this.applyDarkMode(!!darkMode)
    }
  },

  calcCacheSize() {
    try {
      const res = wx.getStorageInfoSync()
      const sizeMB = (res.currentSize / 1024).toFixed(1)
      this.setData({ cacheSize: sizeMB + ' MB' })
    } catch (e) {
      // 忽略计算错误
    }
  },

  /* ========== 编辑资料 ========== */

  onEditProfile() {
    // 游客模式：编辑资料需要登录
    if (this.data.isGuest) {
      this.onGuestLogin()
      return
    }

    const { userInfo } = this.data
    this.setData({
      showEditModal: true,
      editForm: {
        avatarUrl: userInfo.avatarUrl || '',
        nickName: userInfo.nickName || '',
        bio: userInfo.bio || '',
        title: userInfo.title || '',
        phone: userInfo.phone || '',
        email: userInfo.email || ''
      }
    })
  },

  onCloseEditModal() {
    this.setData({ showEditModal: false })
  },

  async onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl
    if (!avatarUrl) return

    wx.showLoading({ title: '上传头像...' })
    try {
      const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
      const uploadResult = await wx.cloud.uploadFile({ cloudPath, filePath: avatarUrl })
      this.setData({ 'editForm.avatarUrl': uploadResult.fileID })
    } catch (error) {
      console.warn('[Profile] 头像上传失败:', error.message)
      wx.showToast({ title: '头像上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onNickNameInput(e) {
    this.setData({ 'editForm.nickName': e.detail.value })
  },

  onBioInput(e) {
    this.setData({ 'editForm.bio': e.detail.value })
  },

  onTitleInput(e) {
    this.setData({ 'editForm.title': e.detail.value })
  },

  onPhoneInput(e) {
    this.setData({ 'editForm.phone': e.detail.value })
  },

  onEmailInput(e) {
    this.setData({ 'editForm.email': e.detail.value })
  },

  onSaveProfile() {
    const form = this.data.editForm

    if (!form.nickName.trim()) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }

    if (form.phone && !/^1[3-9]\d{9}$/.test(form.phone)) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' })
      return
    }

    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      wx.showToast({ title: '邮箱格式不正确', icon: 'none' })
      return
    }

    this.setData({
      'userInfo.nickName': form.nickName,
      'userInfo.bio': form.bio,
      'userInfo.title': form.title,
      'userInfo.phone': form.phone,
      'userInfo.email': form.email,
      'userInfo.avatarUrl': form.avatarUrl || this.data.userInfo.avatarUrl,
      showEditModal: false
    })

    this.saveUserInfo()
    wx.showToast({ title: '资料已保存', icon: 'success' })
  },

  onEditContact() {
    this.onEditProfile()
  },

  onEditEmail() {
    this.onEditProfile()
  },

  saveUserInfo() {
    const info = this.data.userInfo
    wx.setStorageSync('userInfo', info)
    if (app.globalData) {
      app.globalData.userInfo = info
    }
    // 同步到云端（通过 userInfoManager）
    userInfoManager.updateUserInfo(info).catch(err => {
      console.warn('[Profile] 云端同步失败:', err.message)
    })
  },

  // 头像加载失败时清空，显示占位图标
  onUserAvatarError() {
    this.setData({ 'userInfo.avatarUrl': '' })
  },

  /* ========== 深色模式 ========== */

  onToggleDarkMode(e) {
    const darkMode = e.detail.value
    this.setData({ darkMode })
    // 同步到全局
    const app = getApp()
    app.toggleDarkMode(darkMode)
    // 切换当前页面深色类名
    this._setPageDarkClass(darkMode)
  },

  applyDarkMode(enabled) {
    // 加载偏好时也同步页面类名
    this._setPageDarkClass(enabled)
  },

  _setPageDarkClass(enabled) {
    try {
      // 使用 wx 原生 API 设置页面样式
      if (enabled) {
        wx.setBackgroundColor({
          backgroundColor: '#0f172a',
          backgroundColorTop: '#0f172a',
          backgroundColorBottom: '#0f172a'
        })
        wx.setNavigationBarColor({
          frontColor: '#ffffff',
          backgroundColor: '#1e293b'
        })
      } else {
        wx.setBackgroundColor({
          backgroundColor: '#f5f7fa',
          backgroundColorTop: '#f5f7fa',
          backgroundColorBottom: '#f5f7fa'
        })
        wx.setNavigationBarColor({
          frontColor: '#000000',
          backgroundColor: '#ffffff'
        })
      }
    } catch (e) {
      // 某些 API 在低版本基础库不可用，忽略
    }
  },

  /* ========== 数据与存储 ========== */

  onClearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '确定要清除本地缓存数据吗？这不会影响您的账户数据。',
      confirmColor: '#0A3D62',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '清除中...' })
          setTimeout(() => {
            const token = wx.getStorageSync('token')
            const userInfo = this.data.userInfo
            const darkMode = this.data.darkMode

            wx.clearStorageSync()

            wx.setStorageSync('token', token)
            wx.setStorageSync('userInfo', userInfo)
            wx.setStorageSync('darkMode', darkMode)
            wx.setStorageSync('isLoggedIn', true)

            wx.hideLoading()
            this.setData({ cacheSize: '0.0 MB' })
            wx.showToast({ title: '缓存已清除', icon: 'success' })
          }, 800)
        }
      }
    })
  },

  /* ========== 用户反馈 ========== */

  onOpenFeedback() {
    // 游客模式：提交反馈需要登录
    if (this.data.isGuest) {
      this.onGuestLogin()
      return
    }

    this.setData({
      showFeedbackModal: true,
      feedbackContent: '',
      feedbackContact: this.data.userInfo.email || this.data.userInfo.phone || '',
      feedbackCategory: 'general',
      feedbackScore: 0,
      feedbackSubmitting: false
    })
  },

  onCloseFeedback() {
    this.setData({ showFeedbackModal: false })
  },

  onFeedbackInput(e) {
    this.setData({ feedbackContent: e.detail.value })
  },

  onFeedbackContactInput(e) {
    this.setData({ feedbackContact: e.detail.value })
  },

  onFeedbackCategoryChange(e) {
    this.setData({ feedbackCategory: e.currentTarget.dataset.value })
  },

  onFeedbackScoreChange(e) {
    const v = Number(e.currentTarget.dataset.value)
    this.setData({ feedbackScore: this.data.feedbackScore === v ? 0 : v })
  },

  async onSubmitFeedback() {
    const content = this.data.feedbackContent.trim()
    if (!content) {
      wx.showToast({ title: '请输入反馈内容', icon: 'none' })
      return
    }
    if (content.length < 2) {
      wx.showToast({ title: '反馈内容至少2个字', icon: 'none' })
      return
    }

    this.setData({ feedbackSubmitting: true })

    const snapshot = userInfoManager.getUserSnapshot()
    const userId = snapshot.userId || 'anonymous'

    try {
      const res = await wx.cloud.callFunction({
        name: 'feedback',
        data: {
          action: 'submit',
          data: {
            userId,
            nickName: snapshot.nickName,
            avatarUrl: snapshot.avatarUrl,
            content,
            contact: this.data.feedbackContact.trim(),
            category: this.data.feedbackCategory,
            score: this.data.feedbackScore
          }
        }
      })

      if (res.result?.success) {
        wx.showToast({ title: '感谢您的反馈！', icon: 'success' })
        this.setData({ showFeedbackModal: false })
      } else {
        wx.showToast({ title: res.result?.error || '提交失败，请重试', icon: 'none' })
      }
    } catch (err) {
      console.error('[Feedback] 提交异常:', err)
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ feedbackSubmitting: false })
    }
  },

  /* ========== 退出登录 ========== */

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账户吗？退出后将进入游客模式，仍可浏览基础内容。',
      confirmColor: '#dc2626',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync()
          app.globalData.isLoggedIn = false
          app.globalData.isGuest = true
          app.globalData.userInfo = null
          app.globalData.token = null
          wx.reLaunch({ url: '/pages/index/index' })
        }
      }
    })
  },

  noop() {}
})
