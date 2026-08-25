/**
 * 统一用户信息管理器
 *
 * 职责：三个场景共享的用户信息获取、缓存、同步、异常处理
 * 场景 1：对话界面 - 发送消息时显示头像与名称
 * 场景 2：个人中心 - 查看/编辑个人信息
 * 场景 3：后台管理 - 记录对话历史、反馈时关联用户信息
 *
 * 数据流向：
 *   微信登录(wechatLogin) → users 集合(云端) → userInfoManager(本地缓存) → 三个场景
 *   编辑资料(profile)   → users 集合(云端) → userInfoManager(本地缓存) → 三个场景
 *   后台管理           → users 集合(云端) → 直接读取
 */

// 默认头像（本地兜底）
const DEFAULT_AVATAR = '/assets/images/default-avatar.png'
// 预设昵称
const DEFAULT_NICKNAME = '微信用户'

// 缓存键
const CACHE_KEY = 'userInfoCache'
const CACHE_TIME_KEY = 'userInfoCacheTime'
// 缓存有效期：24 小时（毫秒）
const CACHE_TTL = 24 * 60 * 60 * 1000

/**
 * 安全获取 app 实例（避免模块加载时 getApp() 返回 undefined）
 */
function _getApp() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

/**
 * 获取当前用户信息（优先缓存 → 本地存储 → 云端）
 * 返回统一的 { nickName, avatarUrl, userId, openid, role } 结构
 */
function getUserInfo() {
  const app = _getApp()
  // 1. 尝试从缓存读取
  const cached = _getCache()
  if (cached) return _normalize(cached)

  // 2. 尝试从本地存储读取
  const stored = wx.getStorageSync('userInfo')
  if (stored) {
    _setCache(stored)
    return _normalize(stored)
  }

  // 3. 尝试从 app.globalData 读取
  if (app && app.globalData && app.globalData.userInfo) {
    _setCache(app.globalData.userInfo)
    return _normalize(app.globalData.userInfo)
  }

  // 4. 兜底
  return _fallback()
}

/**
 * 异步从云端获取最新用户信息并刷新缓存
 * 用于需要确保信息最新的场景（如个人中心打开时）
 */
async function refreshFromCloud() {
  const app = _getApp()
  const local = getUserInfo()
  const userId = local.userId
  const openid = local.openid

  if (!userId && !openid) return _fallback()

  try {
    const res = await wx.cloud.callFunction({
      name: 'wechatLogin',
      data: {
        action: 'getUser',
        data: { userId, openid }
      }
    })

    if (res.result?.success && res.result.userInfo) {
      const cloudInfo = res.result.userInfo
      const merged = {
        openid: cloudInfo.openid || openid,
        userId: cloudInfo.userId || userId,
        nickName: cloudInfo.nickName || local.nickName,
        avatarUrl: cloudInfo.avatarUrl || local.avatarUrl,
        role: cloudInfo.role || local.role || 'user',
        title: cloudInfo.title || local.title,
        bio: cloudInfo.bio || local.bio,
        phone: cloudInfo.phone || local.phone,
        email: cloudInfo.email || local.email
      }

      // 同步到本地存储和缓存
      wx.setStorageSync('userInfo', merged)
      _setCache(merged)

      if (app && app.globalData) {
        app.globalData.userInfo = merged
      }

      return _normalize(merged)
    }

    return _normalize(local)
  } catch (err) {
    console.warn('[UserInfoManager] 云端刷新失败，使用本地缓存:', err.message)
    return _normalize(local)
  }
}

/**
 * 更新用户信息（本地 + 云端 + 缓存）
 * 编辑资料后调用
 */
async function updateUserInfo(updates) {
  const app = _getApp()
  const current = getUserInfo()
  const merged = { ...current, ...updates }

  // 1. 立即更新本地存储和缓存
  wx.setStorageSync('userInfo', merged)
  _setCache(merged)

  if (app && app.globalData) {
    app.globalData.userInfo = merged
  }

  // 2. 异步同步到云端
  const userId = merged.userId || merged._id
  if (userId) {
    try {
      const response = await wx.cloud.callFunction({
        name: 'wechatLogin',
        data: {
          action: 'updateProfile',
          data: {
            userId,
            openid: merged.openid,
            nickName: merged.nickName,
            avatarUrl: merged.avatarUrl,
            bio: merged.bio,
            title: merged.title,
            phone: merged.phone,
            email: merged.email
          }
        }
      })
      if (!response.result || !response.result.success) {
        throw new Error(response.result?.error || '云端未确认资料更新')
      }
      console.log('[UserInfoManager] 云端同步成功')
    } catch (err) {
      console.warn('[UserInfoManager] 云端同步失败，将在下次刷新时重试:', err.message)
    }
  }

  return _normalize(merged)
}

/**
 * 获取用户头像（带兜底）
 * 返回可用的 avatarUrl，若加载失败返回默认头像
 */
function getAvatarUrl() {
  const info = getUserInfo()
  return info.avatarUrl || DEFAULT_AVATAR
}

/**
 * 获取用户显示名称（带兜底）
 * 优先级：nickName > userId > openid > 默认昵称
 */
function getDisplayName() {
  const info = getUserInfo()
  if (info.nickName && info.nickName !== '微信用户') return info.nickName
  if (info.userId) return `用户${info.userId.slice(-6)}`
  if (info.openid && !info.openid.startsWith('dev_')) return `用户${info.openid.slice(-6)}`
  return DEFAULT_NICKNAME
}

/**
 * 获取持久化的用户信息快照（用于消息记录、反馈等场景）
 * 包含 userId, nickName, avatarUrl 三个字段
 */
function getUserSnapshot() {
  const info = getUserInfo()
  return {
    userId: info.userId || info.openid || 'anonymous',
    nickName: info.nickName || DEFAULT_NICKNAME,
    avatarUrl: info.avatarUrl || ''
  }
}

/**
 * 头像加载失败时的处理
 * 返回默认头像标识，由调用方决定显示默认图标
 */
function onAvatarError() {
  return { fallback: true, avatar: DEFAULT_AVATAR }
}

// ========== 内部方法 ==========

function _normalize(info) {
  return {
    openid: info.openid || '',
    userId: info.userId || info._id || '',
    nickName: info.nickName || DEFAULT_NICKNAME,
    avatarUrl: info.avatarUrl || '',
    role: info.role || 'user',
    title: info.title || '',
    bio: info.bio || '',
    phone: info.phone || '',
    email: info.email || ''
  }
}

function _fallback() {
  return {
    openid: '',
    userId: '',
    nickName: DEFAULT_NICKNAME,
    avatarUrl: '',
    role: 'user',
    title: '',
    bio: '',
    phone: '',
    email: ''
  }
}

function _getCache() {
  try {
    const cacheTime = wx.getStorageSync(CACHE_TIME_KEY)
    if (!cacheTime) return null

    const now = Date.now()
    if (now - cacheTime > CACHE_TTL) {
      // 缓存过期，清除
      wx.removeStorageSync(CACHE_KEY)
      wx.removeStorageSync(CACHE_TIME_KEY)
      return null
    }

    return wx.getStorageSync(CACHE_KEY) || null
  } catch (e) {
    return null
  }
}

function _setCache(info) {
  try {
    wx.setStorageSync(CACHE_KEY, info)
    wx.setStorageSync(CACHE_TIME_KEY, Date.now())
  } catch (e) {
    // storage 满时静默失败
  }
}

module.exports = {
  getUserInfo,
  refreshFromCloud,
  updateUserInfo,
  getAvatarUrl,
  getDisplayName,
  getUserSnapshot,
  onAvatarError,
  DEFAULT_AVATAR,
  DEFAULT_NICKNAME
}
