const chatStreamManager = require('../../utils/chatStreamManager')

Component({
  properties: {
    currentTab: {
      type: String,
      value: 'index'
    }
  },

  data: {
    tabs: [
      { key: 'index', icon: '💬', text: '对话' },
      { key: 'knowledge', icon: '📚', text: '知识库' },
      { key: 'graph', icon: '🔗', text: '知识图谱' },
      { key: 'profile', icon: '👤', text: '个人中心' }
    ],
    chatStreaming: false,   // AI 是否正在思考
    streamPreview: ''       // 当前流式预览（用于 tooltip）
  },

  lifetimes: {
    attached() {
      // 订阅全局流式状态：任意 Tab 都能看到"AI 思考中"指示器
      this._unsubscribe = chatStreamManager.subscribe((state) => {
        this.setData({
          chatStreaming: state.isRunning,
          streamPreview: state.preview || ''
        })
      })
    },
    detached() {
      if (this._unsubscribe) {
        this._unsubscribe()
        this._unsubscribe = null
      }
    }
  },

  methods: {
    switchTab(e) {
      const key = e.currentTarget.dataset.key
      if (key === this.properties.currentTab) return

      // 触觉反馈
      wx.vibrateShort({ type: 'light' })

      const app = getApp()
      const isGuest = app.globalData.isGuest || !app.globalData.isLoggedIn

      // 游客模式：访问个人中心时引导登录
      if (key === 'profile' && isGuest) {
        app.requireLogin('/pages/profile/profile', '登录后可查看个人信息、编辑资料和使用全部功能')
        return
      }

      const urlMap = {
        index: '/pages/index/index',
        knowledge: '/pages/knowledge/knowledge',
        graph: '/pages/graph/graph',
        profile: '/pages/profile/profile'
      }

      wx.reLaunch({
        url: urlMap[key]
      })
    },

    // 点击"对话"Tab 上的思考中指示器，跳回对话页查看进度
    onStreamingTap() {
      if (this.properties.currentTab === 'index') return
      wx.reLaunch({ url: '/pages/index/index' })
    },

    stopPropagation() {
      // 阻止事件冒泡
    }
  }
})
