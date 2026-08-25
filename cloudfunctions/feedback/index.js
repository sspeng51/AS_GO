/**
 * feedback 云函数
 *
 * 功能: 用户反馈的提交与查询
 * 数据: feedback 集合
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLL = 'feedback'

exports.main = async (event, context) => {
  const { action, data = {} } = (event && typeof event === 'object') ? event : {}

  console.log(`[feedback] action=${action}, userId=${data.userId}`)

  try {
    switch (action) {
      case 'submit':
        return await handleSubmit(data, context)
      case 'list':
        return await handleList(data, context)
      default:
        return { success: false, error: `未知操作: ${action}` }
    }
  } catch (err) {
    console.error('[feedback] 异常:', err.message)
    return { success: false, error: err.message || '服务器内部错误' }
  }
}

/**
 * 提交反馈
 */
async function handleSubmit(data, context) {
  const { userId, content, contact, category = 'general', nickName, avatarUrl, score } = data

  if (!content || !content.trim()) {
    return { success: false, error: '反馈内容不能为空' }
  }
  if (content.length > 2000) {
    return { success: false, error: '反馈内容不能超过2000字' }
  }
  if (contact && String(contact).length > 200) {
    return { success: false, error: '联系方式不能超过 200 个字符' }
  }
  const safeCategory = ['general', 'bug', 'feature', 'rating', 'other'].includes(category)
    ? category
    : 'general'

  // 评分校验：1-10 整数，未评分时存 0
  let ratingScore = 0
  if (score !== undefined && score !== null && score !== '') {
    const n = Number(score)
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return { success: false, error: '评分应为 1-10 的整数' }
    }
    ratingScore = n
  }

  const now = new Date()
  // 云函数上下文中的 OPENID 由平台签发，优先于客户端上传的 userId，
  // 避免用户伪造他人身份提交反馈；游客环境再保留匿名兜底。
  let trustedUserId = 'anonymous'
  try {
    const wxContext = cloud.getWXContext()
    trustedUserId = wxContext.OPENID || wxContext.openid || (context && (context.OPENID || context.openid)) || trustedUserId
  } catch (e) {}
  let trustedNickName = ''
  let trustedAvatarUrl = ''
  if (trustedUserId !== 'anonymous') {
    try {
      const userResult = await db.collection('users').where({ openid: trustedUserId }).limit(1).get()
      const user = userResult.data && userResult.data[0]
      if (user) {
        trustedNickName = user.nickName || ''
        trustedAvatarUrl = user.avatarUrl || ''
      }
    } catch (e) {
      console.warn('[feedback] 读取用户快照失败:', e.message)
    }
  }

  try {
    const res = await db.collection(COLL).add({
      data: {
        userId: trustedUserId,
        nickName: trustedNickName,
        avatarUrl: trustedAvatarUrl,
        content: content.trim(),
        contact: contact || '',
        category: safeCategory,
        score: ratingScore,         // AI 评分 1-10，0 表示未评分
        status: 'pending',         // pending / resolved / closed
        adminNote: '',             // 管理员备注
        createdAt: now,
        updatedAt: now
      }
    })

    console.log(`[feedback] 反馈提交成功, id=${res._id}`)
    return {
      success: true,
      feedbackId: res._id,
      message: '感谢您的反馈，我们会尽快处理！'
    }
  } catch (err) {
    console.error('[feedback] 提交失败:', err.message)
    return { success: false, error: '提交失败，请稍后再试' }
  }
}

/**
 * 查询反馈列表（管理员用）
 */
async function handleList(data, context) {
  const { status, page = 1, pageSize = 20 } = data

  // 管理后台使用独立、已认证的 HTTP API 查询全量反馈；云函数入口只能
  // 返回当前微信用户自己的记录，不能信任调用方传入的 userId。
  let trustedUserId = ''
  try {
    const wxContext = cloud.getWXContext()
    trustedUserId = wxContext.OPENID || wxContext.openid || (context && (context.OPENID || context.openid)) || ''
  } catch (e) {}
  if (!trustedUserId) {
    return { success: false, error: '用户身份识别失败，无法查询反馈记录' }
  }

  try {
    const where = { userId: trustedUserId }
    if (status) where.status = status

    const p = Math.max(1, parseInt(page, 10) || 1)
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20))

    const countR = await db.collection(COLL).where(where).count()
    const total = countR.total || 0

    const listR = await db.collection(COLL)
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip((p - 1) * ps)
      .limit(ps)
      .get()

    const items = (listR.data || []).map(item => ({
      feedbackId: item._id,
      userId: item.userId,
      nickName: item.nickName || '',
      avatarUrl: item.avatarUrl || '',
      content: item.content,
      contact: item.contact || '',
      category: item.category || 'general',
      score: typeof item.score === 'number' ? item.score : 0,
      status: item.status || 'pending',
      adminNote: item.adminNote || '',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))

    return {
      success: true,
      items,
      pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) }
    }
  } catch (err) {
    console.error('[feedback] 查询失败:', err.message)
    return { success: false, error: '查询失败' }
  }
}
