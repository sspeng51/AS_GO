const app = getApp()
const userInfoManager = require('../../utils/userInfoManager')

Page({
  data: {
    agreePrivacy: false,
    loading: false,
    loginError: '',
    hasAvatar: false,          // 是否已设置头像
    canLogin: false,          // 是否可以登录（头像+昵称都有了）
    userInfo: {
      avatarUrl: '',
      nickName: ''
    },
    redirectUrl: '',
    darkMode: false,
  },

  onLoad(options) {
    this._initDarkMode()
    if (options.redirect) this.setData({ redirectUrl: decodeURIComponent(options.redirect) })
    const token = wx.getStorageSync('token')
    if (token) {
      const url = this.data.redirectUrl
      if (url) { wx.redirectTo({ url }) } else { wx.reLaunch({ url: '/pages/index/index' }) }
    }
  },

  onAgreeChange(e) {
    this.setData({ agreePrivacy: e.detail.value.length > 0 })
  },

  /* ========== 登录 ========== */
  async onWechatLogin() {
    if (!this.data.agreePrivacy) { wx.showToast({ title: '请先同意用户协议', icon: 'none' }); return }
    if (this.data.loading) return

    const nickName = (this.data.userInfo.nickName || '').trim()
    if (!nickName) { this.setData({ loginError: '请输入昵称' }); return }

    if (!this.data.hasAvatar) { this.setData({ loginError: '请设置头像' }); return }

    this.setData({ loading: true, loginError: '' })
    wx.showLoading({ title: '登录中...', mask: true })

    try {
      const code = await this._wxLogin()
      const result = await this._callLoginCloud(code, nickName, this.data.userInfo.avatarUrl)
      if (!result.success) throw new Error(result.error || '登录失败')

      const info = result.userInfo
      wx.setStorageSync('token', info.openid)
      wx.setStorageSync('userInfo', info)

      app.globalData.isLoggedIn = true
      app.globalData.isGuest = false
      app.globalData.userInfo = info
      app.globalData.token = info.openid
      app.globalData.userId = info.userId || null

      userInfoManager.updateUserInfo(info).catch(() => {})

      wx.hideLoading()
      wx.showToast({ title: '登录成功', icon: 'success', duration: 1200 })
      setTimeout(() => {
        if (this.data.redirectUrl) { wx.redirectTo({ url: this.data.redirectUrl }) }
        else { wx.reLaunch({ url: '/pages/index/index' }) }
      }, 1200)
    } catch (err) {
      console.error('[Login] 失败:', err)
      wx.hideLoading()
      this.setData({ loading: false, loginError: err.message || '登录失败，请稍后重试' })
      wx.showToast({ title: err.message || '登录失败', icon: 'none', duration: 2000 })
    }
  },

  _wxLogin() {
    return new Promise((resolve, reject) => {
      wx.login({
        success(res) { res.code ? resolve(res.code) : reject(new Error(res.errMsg || '空 code')) },
        fail(err) { reject(new Error(err.errMsg || '微信登录失败')) }
      })
    })
  },

  _callLoginCloud(code, nickName, avatarUrl) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'wechatLogin',
        data: { action: 'login', data: { code, nickName, avatarUrl } },
        success(res) {
          if (res.result?.success) resolve(res.result)
          else reject(new Error((res.result?.error) || '云函数异常'))
        },
        fail(err) { reject(new Error('云服务连接失败')) }
      })
    })
  },

  /* ========== 微信头像授权 + 上传云存储 ========== */
  async onChooseAvatar(e) {
    // open-type="chooseAvatar" 返回微信头像临时路径
    const avatarUrl = e.detail.avatarUrl
    if (!avatarUrl) return

    // 先显示预览
    this.setData({ 'userInfo.avatarUrl': avatarUrl, hasAvatar: true })

    // 上传到云存储获取永久 URL
    try {
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `avatars/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`,
        filePath: avatarUrl
      })
      if (uploadRes.fileID) {
        this.setData({ 'userInfo.avatarUrl': uploadRes.fileID })
        console.log('[Login] 头像已上传:', uploadRes.fileID)
      }
    } catch (err) {
      console.warn('[Login] 头像上传失败:', err.message)
      this.setData({ 'userInfo.avatarUrl': '', hasAvatar: false, canLogin: false })
      wx.showToast({ title: '头像上传失败，请重试', icon: 'none' })
    }

    this._checkCanLogin()
  },

  // 按钮级错误处理（取消选择等）
  onAvatarBtnError(e) {
    // chooseAvatar cancel 等错误静默忽略
    if (e.detail?.errMsg && e.detail.errMsg.indexOf('cancel') !== -1) return
    console.warn('[Login] 头像按钮异常:', e.detail?.errMsg)
  },

  onNickNameInput(e) {
    this.setData({ 'userInfo.nickName': e.detail.value })
    this._checkCanLogin()
  },

  onAvatarError() {
    this.setData({ 'userInfo.avatarUrl': '', hasAvatar: false })
    this._checkCanLogin()
  },

  // 检查是否满足登录条件
  _checkCanLogin() {
    const hasNick = !!(this.data.userInfo.nickName || '').trim()
    const hasAv = !!this.data.userInfo.avatarUrl
    this.setData({ canLogin: hasNick && hasAv, hasAvatar: hasAv })
  },

  onViewAgreement() { wx.navigateTo({ url: '/pages/agreement/agreement' }) },
  onViewPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }) },

  _initDarkMode() {
    const dm = getApp().globalData.darkMode
    this.setData({ darkMode: dm })
    if (dm) {
      try {
        wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: '#1e293b' })
        wx.setBackgroundColor({ backgroundColor: '#0f172a', backgroundColorTop: '#0f172a', backgroundColorBottom: '#0f172a' })
      } catch (_) {}
    }
  },

  onGuestEntry() {
    const app = getApp()
    app.globalData.isGuest = true
    app.globalData.isLoggedIn = false
    if (this.data.redirectUrl) { wx.redirectTo({ url: this.data.redirectUrl }) }
    else { wx.reLaunch({ url: '/pages/index/index' }) }
  }
})
