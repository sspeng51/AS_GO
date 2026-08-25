/**
 * wechatLogin 云函数
 *
 * 功能: 接收小程序端 wx.login() 的 code，换取 openid，管理用户信息
 * 路径: 小程序端 -> 云函数 -> 微信 jscode2session -> 返回用户信息
 *
 * 优势: 走云函数通道，不受 request 合法域名限制
 */

const cloud = require('wx-server-sdk')

// 初始化（使用当前云环境）
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION_USERS = 'users'
const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === 'true'

function getTrustedOpenId(context) {
  try {
    const wxContext = cloud.getWXContext()
    if (wxContext && (wxContext.OPENID || wxContext.openid)) {
      return wxContext.OPENID || wxContext.openid
    }
  } catch (e) {}
  return context && (context.OPENID || context.openid) || ''
}

async function ensureUsersCollection() {
  try {
    await db.createCollection(COLLECTION_USERS)
  } catch (e) {
    const message = String(e && (e.message || e.errMsg) || '')
    const alreadyExists = /exist|already/i.test(message) || e.code === 'DATABASE_COLLECTION_EXIST'
    if (!alreadyExists && !/permission/i.test(message)) throw e
  }
}

exports.main = async (event, context) => {
  const { action, data = {} } = (event && typeof event === 'object') ? event : {}

  console.log(`[wechatLogin] 收到请求: action=${action}`)

  try {
    switch (action) {
      case 'login':
        return await handleLogin(data, context)
      case 'getUser':
        return await handleGetUser(data, context)
      case 'updateProfile':
        return await handleUpdateProfile(data, context)
      default:
        return { success: false, error: `未知操作: ${action}` }
    }
  } catch (err) {
    console.error('[wechatLogin] 异常:', err.message)
    return { success: false, error: '服务器内部错误，请稍后重试' }
  }
}

/**
 * 处理登录：code 换取 openid
 */
async function handleLogin(data, context) {
  const { code, nickName, avatarUrl } = data

  if (!code) {
    return { success: false, error: '缺少登录凭证 code' }
  }
  if (nickName && String(nickName).trim().length > 40) {
    return { success: false, error: '昵称不能超过 40 个字符' }
  }
  if (avatarUrl && !/^(cloud:\/\/|https:\/\/)/i.test(String(avatarUrl))) {
    return { success: false, error: '头像尚未上传完成，请重新选择' }
  }

  // 云函数调用上下文中的 OPENID 由微信平台签发，优先使用它。
  let openid, unionid, isDevMode = false
  const contextOpenId = getTrustedOpenId(context)
  if (contextOpenId) {
    openid = contextOpenId
  } else try {
    const result = await cloud.openapi.auth.code2Session({
      code: code
    })

    console.log('[wechatLogin] code2Session 结果:', JSON.stringify(result).substring(0, 200))

    // 检查微信接口是否返回错误（-1=系统繁忙/未发布等）
    if (result.errcode || result.errCode) {
      const errCode = String(result.errcode || result.errCode)
      console.warn(`[wechatLogin] 微信接口返回错误码: ${errCode}`)

      // 开发身份必须由环境变量显式启用，生产环境禁止静默降级。
      if (ALLOW_DEV_LOGIN && (errCode === '-1' || errCode === '0' || !result.openid)) {
        isDevMode = true
        openid = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
        console.warn('[wechatLogin] 开发模式降级, openid:', openid)
      } else {
        const errMsgs = {
          '40029': '登录凭证无效',
          '45011': '请求频率超限',
          '40125': 'AppSecret 配置错误'
        }
        return {
          success: false,
          error: errMsgs[errCode] || `登录失败 (${errCode})`,
          errCode
        }
      }
    } else {
      openid = result.openid
      unionid = result.unionid || ''
    }

    if (!openid && ALLOW_DEV_LOGIN) {
      isDevMode = true
      openid = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    }
  } catch (apiErr) {
    console.error('[wechatLogin] jscode2session 异常:', apiErr)
    if (!ALLOW_DEV_LOGIN) {
      return { success: false, error: '微信身份校验失败，请稍后重试' }
    }
    isDevMode = true
    openid = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    console.warn('[wechatLogin] 接口异常，已显式启用开发模式降级')
  }

  // 查找或创建用户记录
  let userRecord = null
  try {
    await ensureUsersCollection()
    const existing = await db.collection(COLLECTION_USERS)
      .where({ openid })
      .limit(1)
      .get()

    const now = new Date()

    if (existing.data && existing.data.length > 0) {
      // 更新已有用户
      const userId = existing.data[0]._id
      const updateData = {
        lastLoginAt: now,
        updatedAt: now,
        loginCount: db.command.inc(1)
      }

      if (nickName) updateData.nickName = nickName
      if (avatarUrl) updateData.avatarUrl = avatarUrl

      await db.collection(COLLECTION_USERS).doc(userId).update({
        data: updateData
      })

      const updated = await db.collection(COLLECTION_USERS).doc(userId).get()
      userRecord = updated.data
    } else {
      // 创建新用户
      const addRes = await db.collection(COLLECTION_USERS).add({
        data: {
          openid,
          unionid: unionid || '',
          nickName: nickName || '微信用户',
          avatarUrl: avatarUrl || '',
          role: 'user',
          status: 'active',
          loginCount: 1,
          createdAt: now,
          lastLoginAt: now,
          updatedAt: now
        }
      })

      userRecord = {
        _id: addRes._id,
        openid,
        nickName: nickName || '微信用户',
        avatarUrl: avatarUrl || '',
        role: 'user',
        isNewUser: true
      }
    }
  } catch (dbErr) {
    console.error('[wechatLogin] 数据库操作失败:', dbErr.message)
    return { success: false, error: '用户数据暂时不可用，请稍后重试' }
  }

  return {
    success: true,
    userInfo: {
      openid: userRecord.openid || openid,
      userId: userRecord._id || null,
      nickName: userRecord.nickName || nickName || '微信用户',
      avatarUrl: userRecord.avatarUrl || avatarUrl || '',
      role: userRecord.role || 'user',
      isNewUser: !!userRecord.isNewUser,
      isDevMode
    }
  }
}

/**
 * 获取用户信息
 */
async function handleGetUser(data, context) {
  const { openid, userId } = data

  const trustedOpenId = getTrustedOpenId(context)
  const devOpenId = ALLOW_DEV_LOGIN && openid && String(openid).startsWith('dev_') ? String(openid) : ''
  const effectiveOpenId = trustedOpenId || devOpenId
  if (!effectiveOpenId) {
    return { success: false, error: '用户身份校验失败' }
  }

  try {
    const res = await db.collection(COLLECTION_USERS)
      .where({ openid: effectiveOpenId })
      .limit(1)
      .get()
    const record = res.data?.[0]

    if (!record) {
      return { success: false, error: '用户不存在' }
    }

    const { _id, openid: _, ...safeInfo } = record
    return {
      success: true,
      userInfo: { userId: _id, ...safeInfo }
    }
  } catch (err) {
    console.error('[wechatLogin] 获取用户失败:', err.message)
    return { success: false, error: '获取用户信息失败，请稍后重试' }
  }
}

/**
 * 更新用户资料
 */
async function handleUpdateProfile(data, context) {
  const { openid, nickName, avatarUrl, bio, title, phone, email } = data
  const trustedOpenId = getTrustedOpenId(context)
  const devOpenId = ALLOW_DEV_LOGIN && openid && String(openid).startsWith('dev_') ? String(openid) : ''
  const effectiveOpenId = trustedOpenId || devOpenId

  if (!effectiveOpenId) {
    return { success: false, error: '用户身份校验失败' }
  }
  if (nickName !== undefined && (!String(nickName).trim() || String(nickName).trim().length > 40)) {
    return { success: false, error: '昵称长度应为 1-40 个字符' }
  }
  if (bio !== undefined && String(bio).length > 500) {
    return { success: false, error: '个人简介不能超过 500 个字符' }
  }
  if (title !== undefined && String(title).length > 80) {
    return { success: false, error: '职位不能超过 80 个字符' }
  }
  if (phone && !/^1[3-9]\d{9}$/.test(String(phone))) {
    return { success: false, error: '手机号格式不正确' }
  }
  if (email && (String(email).length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)))) {
    return { success: false, error: '邮箱格式不正确' }
  }
  if (avatarUrl && !/^(cloud:\/\/|https:\/\/)/i.test(String(avatarUrl))) {
    return { success: false, error: '头像地址无效，请重新上传' }
  }

  try {
    const found = await db.collection(COLLECTION_USERS)
      .where({ openid: effectiveOpenId })
      .limit(1)
      .get()
    const user = found.data?.[0]
    if (!user) return { success: false, error: '用户不存在' }

    const updateData = { updatedAt: new Date() }
    if (nickName !== undefined) updateData.nickName = String(nickName).trim()
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl
    if (bio !== undefined) updateData.bio = bio
    if (title !== undefined) updateData.title = title
    if (phone !== undefined) updateData.phone = phone
    if (email !== undefined) updateData.email = email

    await db.collection(COLLECTION_USERS).doc(user._id).update({
      data: updateData
    })

    return { success: true, message: '资料已更新' }
  } catch (err) {
    console.error('[wechatLogin] 更新资料失败:', err.message)
    return { success: false, error: '更新资料失败，请稍后重试' }
  }
}
