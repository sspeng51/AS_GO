/**
 * 微信小程序登录 API 路由
 *
 * 流程: 小程序端 wx.login() -> code -> 后端 -> 微信 jscode2session -> openid/session_key
 * 返回: JWT token + 用户信息
 */

const express = require('express')
const https = require('https')
const { generateToken } = require('../middleware/auth')
const { getDBOrNull, COLLECTIONS } = require('../utils/cloudbase')

const router = express.Router()

// 微信小程序配置
const WECHAT_APPID = process.env.WECHAT_APPID || ''
const WECHAT_SECRET = process.env.WECHAT_SECRET || ''
const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === 'true'

function requestWechatSession(code) {
  const params = new URLSearchParams({
    appid: WECHAT_APPID,
    secret: WECHAT_SECRET,
    js_code: code,
    grant_type: 'authorization_code'
  })

  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'api.weixin.qq.com',
      path: `/sns/jscode2session?${params.toString()}`,
      timeout: 10000
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(new Error('微信登录接口返回了无效响应'))
        }
      })
    })
    req.on('timeout', () => {
      const error = new Error('微信服务器响应超时')
      error.code = 'ETIMEDOUT'
      req.destroy(error)
    })
    req.on('error', reject)
  })
}

/**
 * POST /api/wechat/login
 * Body: { code: string, nickName?: string, avatarUrl?: string }
 */
router.post('/login', async (req, res) => {
  try {
    const { code, nickName, avatarUrl } = req.body

    if (!code) {
      return res.status(400).json({ error: '缺少登录凭证 code' })
    }
    if (nickName && String(nickName).trim().length > 40) {
      return res.status(400).json({ error: '昵称不能超过 40 个字符' })
    }
    if (avatarUrl && !/^(cloud:\/\/|https:\/\/)/i.test(String(avatarUrl))) {
      return res.status(400).json({ error: '头像地址无效' })
    }

    if (!WECHAT_APPID || !WECHAT_SECRET) {
      if (!ALLOW_DEV_LOGIN) {
        return res.status(503).json({ error: '微信登录未配置，请联系管理员' })
      }
      console.warn('[WeChat] 未配置 WECHAT_APPID/SECRET，且已显式启用开发登录')
      const mockOpenId = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      const token = generateToken({
        openid: mockOpenId,
        role: 'user',
        type: 'dev'
      })

      return res.json({
        success: true,
        token,
        userInfo: {
          openid: mockOpenId,
          nickName: nickName || '微信用户',
          avatarUrl: avatarUrl || '',
          isDev: true
        }
      })
    }

    // 调用微信 jscode2session 接口
    const wxData = await requestWechatSession(code)

    // 微信返回错误
    if (wxData.errcode) {
      console.error('[WeChat] jscode2session 失败:', wxData)
      const errorMessages = {
        '-1': '微信系统繁忙，请稍后重试',
        '40029': 'code 无效，请重新获取',
        '45011': '频率限制，请稍后重试',
        '40125': 'AppSecret 错误',
        '41002': 'appid 缺失'
      }
      const message = errorMessages[String(wxData.errcode)] || `微信登录失败 (${wxData.errcode})`
      return res.status(400).json({ error: message, code: wxData.errcode })
    }

    const { openid, unionid } = wxData

    if (!openid) {
      return res.status(500).json({ error: '获取 openid 失败' })
    }

    // 尝试存储/更新用户信息到数据库
    const db = getDBOrNull()
    let userRecord = null

    if (db) {
      try {
        // 查找已有用户
        const existing = await db.collection(COLLECTIONS.USERS)
          .where({ openid })
          .limit(1)
          .get()

        const now = new Date()

        if (existing.data && existing.data.length > 0) {
          // 更新用户信息
          const userId = existing.data[0]._id
          await db.collection(COLLECTIONS.USERS).doc(userId).update({
            nickName: nickName || existing.data[0].nickName || '微信用户',
            avatarUrl: avatarUrl || existing.data[0].avatarUrl || '',
            lastLoginAt: now,
            updatedAt: now
          })
          userRecord = { ...existing.data[0], nickName: nickName || existing.data[0].nickName, avatarUrl: avatarUrl || existing.data[0].avatarUrl }
        } else {
          // 创建新用户
          const addRes = await db.collection(COLLECTIONS.USERS).add({
            openid,
            unionid: unionid || '',
            nickName: nickName || '微信用户',
            avatarUrl: avatarUrl || '',
            role: 'user',
            status: 'active',
            createdAt: now,
            lastLoginAt: now,
            updatedAt: now
          })
          userRecord = {
            _id: addRes.id,
            openid,
            nickName: nickName || '微信用户',
            avatarUrl: avatarUrl || ''
          }
        }
      } catch (dbErr) {
        console.warn('[WeChat] 数据库操作失败，仅返回 token:', dbErr.message)
      }
    }

    // 生成 JWT
    const token = generateToken({
      openid,
      userId: userRecord?._id || null,
      role: 'user',
      type: 'wechat'
    })

    res.json({
      success: true,
      token,
      userInfo: {
        openid,
        userId: userRecord?._id || null,
        nickName: userRecord?.nickName || nickName || '微信用户',
        avatarUrl: userRecord?.avatarUrl || avatarUrl || '',
        unionid: unionid || null
      }
    })
  } catch (err) {
    console.error('[WeChat] 登录异常:', err.message)

    // 网络超时等异常
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: '微信服务器响应超时，请检查网络后重试' })
    }

    res.status(500).json({ error: '服务器内部错误，请稍后重试' })
  }
})

/**
 * GET /api/wechat/check
 * 检查微信配置是否就绪
 */
router.get('/check', (req, res) => {
  res.json({
    configured: !!(WECHAT_APPID && WECHAT_SECRET),
    mode: (WECHAT_APPID && WECHAT_SECRET) ? 'production' : 'dev'
  })
})

module.exports = router
