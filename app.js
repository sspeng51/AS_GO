const config = require('./config/config')

App({
  onLaunch() {
    console.log('🚀 应用启动，正在初始化云开发...')

    this.initCloud()

    // 检查登录状态：优先使用 token 验证
    const token = wx.getStorageSync('token')

    if (token) {
      // 已登录用户：恢复登录状态
      this.globalData.token = token
      this.globalData.isLoggedIn = true
      this.globalData.isGuest = false
      this.globalData.userInfo = wx.getStorageSync('userInfo') || null
    } else {
      // 游客模式：不强制跳转登录页，允许直接进入主界面浏览基础内容
      this.globalData.isLoggedIn = false
      this.globalData.isGuest = true
      this.globalData.token = null
      this.globalData.userInfo = null
      console.log('👤 游客模式启动，用户可直接浏览基础内容')
    }

    // 加载深色模式偏好
    const darkMode = wx.getStorageSync('darkMode')
    this.globalData.darkMode = !!darkMode
    if (this.globalData.darkMode) {
      this._applyPageDarkMode()
    }

    // 检查更新
    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager()
      updateManager.onCheckForUpdate(() => {})
      updateManager.onUpdateReady(() => {
        wx.showModal({
          title: '更新提示',
          content: '新版本已就绪，是否重启应用？',
          confirmText: '重启',
          success: (res) => {
            if (res.confirm) updateManager.applyUpdate()
          }
        })
      })
    }
  },

  /**
   * 全局切换深色模式，并通知所有页面
   */
  toggleDarkMode(enabled) {
    this.globalData.darkMode = enabled
    wx.setStorageSync('darkMode', enabled)
    this._applyPageDarkMode()
    // 广播深色模式变化，所有页面可监听
    this._notifyDarkModeChange(enabled)
  },

  /**
   * 通知所有页面深色模式已变化
   */
  _notifyDarkModeChange(enabled) {
    const pages = getCurrentPages()
    pages.forEach(page => {
      if (page && typeof page.onDarkModeChange === 'function') {
        page.onDarkModeChange(enabled)
      }
    })
  },

  _applyPageDarkMode() {
    const enabled = this.globalData.darkMode
    // 设置导航栏颜色
    wx.setNavigationBarColor({
      frontColor: enabled ? '#ffffff' : '#000000',
      backgroundColor: enabled ? '#1e293b' : '#ffffff',
      animation: { duration: 300, timingFunc: 'easeInOut' }
    })
    // 设置窗口背景
    wx.setBackgroundTextStyle({ textStyle: enabled ? 'light' : 'dark' })
    wx.setBackgroundColor({
      backgroundColor: enabled ? '#0f172a' : '#faf9fd',
      backgroundColorTop: enabled ? '#0f172a' : '#faf9fd',
      backgroundColorBottom: enabled ? '#0f172a' : '#faf9fd'
    })
  },

  initCloud() {
    try {
      if (!wx.cloud) {
        console.error('❌ 请使用 2.2.3 或以上的基础库以使用云能力')
        return false
      }

      wx.cloud.init({
        env: config.cloud.envId || 'cloud1-6gbzplmt4a3dc5b5',
        traceUser: true,
      })

      console.log('✅ 云开发初始化成功！环境ID:', config.cloud.envId)

      this.globalData.cloudInitialized = true

      return true

    } catch (error) {
      console.error('❌ 云开发初始化失败:', error)

      wx.showModal({
        title: '云开发初始化失败',
        content:
          '可能原因：\n' +
          '1. 未开通云开发服务\n' +
          '2. 环境ID配置错误\n' +
          '3. 网络连接异常\n\n' +
          '请检查后重启小程序',
        showCancel: false,
        confirmText: '我知道了'
      })

      return false
    }
  },

  /**
   * 检查登录状态，返回是否已登录。不强制跳转，由调用方决定处理方式。
   * @returns {boolean}
   */
  checkLoginStatus() {
    const token = wx.getStorageSync('token')
    if (!token) {
      this.globalData.isLoggedIn = false
      this.globalData.isGuest = true
      this.globalData.userInfo = null
      this.globalData.token = null
      return false
    }
    return true
  },

  /**
   * 引导用户登录，跳转到登录页并可携带来源页信息
   * @param {string} redirectUrl - 登录成功后跳回的页面路径
   * @param {string} purpose - 授权目的说明
   */
  requireLogin(redirectUrl, purpose) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '需要登录',
        content: purpose || '该功能需要登录后才能使用，是否前往登录？',
        confirmText: '去登录',
        cancelText: '暂不登录',
        success: (res) => {
          if (res.confirm) {
            const url = redirectUrl
              ? `/pages/login/login?redirect=${encodeURIComponent(redirectUrl)}`
              : '/pages/login/login'
            wx.navigateTo({ url })
          }
          resolve(res.confirm)
        }
      })
    })
  },

  globalData: {
    userInfo: null,
    isLoggedIn: false,
    isGuest: true,
    cloudInitialized: false,
    userId: null,
    token: null,
    darkMode: false
  }
})