Page({
  data: {
    darkMode: false
  },

  onLoad() {
    const app = getApp()
    this.setData({ darkMode: app.globalData.darkMode })
    if (app.globalData.darkMode) {
      this._applyDarkMode()
    }
  },

  _applyDarkMode() {
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: '#1e293b'
    })
    wx.setBackgroundColor({
      backgroundColor: '#0f172a',
      backgroundColorTop: '#0f172a',
      backgroundColorBottom: '#0f172a'
    })
  }
})