/**
 * 用户反馈管理 API 路由
 */

const express = require('express')
const { getDB, resolveCloudFileURLs } = require('../utils/cloudbase')
const { authMiddleware, requireAdmin, requireStaff } = require('../middleware/auth')

const router = express.Router()
const COLL = 'feedback'

// 安全查询
async function safeGet(fn) {
  try { return await fn() }
  catch (err) {
    if (/not.exist/i.test(err.message) || ['DATABASE_COLLECTION_NOT_EXIST', 'RESOURCE_NOT_FOUND'].includes(err.code))
      return { data: [], total: 0 }
    throw err
  }
}

/**
 * 将反馈数据中的 cloud:// 头像 URL 转换为 HTTPS 可访问 URL
 */
async function resolveFeedAvatars(items) {
  const cloudIds = items.map(i => i.avatarUrl).filter(u => u && typeof u === 'string' && u.startsWith('cloud://'))
  if (cloudIds.length === 0) return

  const urlMap = await resolveCloudFileURLs(cloudIds)
  if (urlMap.size === 0) return

  for (const item of items) {
    if (item.avatarUrl && urlMap.has(item.avatarUrl)) {
      item.avatarUrl = urlMap.get(item.avatarUrl)
    }
  }
}

router.use(authMiddleware, requireStaff)

// GET /api/feedback/list
router.get('/list', async (req, res) => {
  try {
    const db = getDB()
    const { userId, status, keyword, category, dateFrom, dateTo } = req.query

    const where = {}
    if (userId) where.userId = userId
    if (status) {
      if (!['pending', 'resolved', 'closed'].includes(status)) {
        return res.status(400).json({ error: '无效的状态筛选值' })
      }
      where.status = status
    }
    if (category) where.category = String(category).substring(0, 40)
    if (keyword) {
      const safeKeyword = String(keyword).substring(0, 100)
      where.content = db.RegExp({ regexp: safeKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
    }
    const fromDate = dateFrom ? new Date(dateFrom) : null
    const toDate = dateTo ? new Date(dateTo) : null
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
      return res.status(400).json({ error: '日期格式无效' })
    }
    if (fromDate) where.createdAt = db.command.gte(fromDate)
    if (dateTo) {
      toDate.setHours(23, 59, 59, 999)
      where.createdAt = fromDate
        ? db.command.and(db.command.gte(fromDate), db.command.lte(toDate))
        : db.command.lte(toDate)
    }

    const p = Math.max(1, parseInt(req.query.page, 10) || 1)
    const ps = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))

    const countR = await safeGet(() => db.collection(COLL).where(where).count())
    const total = countR.total || 0

    const listR = await safeGet(() =>
      db.collection(COLL)
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip((p - 1) * ps)
        .limit(ps)
        .get()
    )

    const items = (listR.data || []).map(item => ({
      feedbackId: item._id,
      userId: item.userId || 'anonymous',
      nickName: item.nickName || '',
      avatarUrl: item.avatarUrl || '',
      content: item.content || '',
      contact: item.contact || '',
      category: item.category || 'general',
      score: typeof item.score === 'number' ? item.score : 0,
      status: item.status || 'pending',
      adminNote: item.adminNote || '',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))

    // 批量查询 users 集合补充缺失的用户信息（昵称或头像为空时都补）
    const missingUsers = items.filter(u => u.userId && (!u.nickName || !u.avatarUrl))
    if (missingUsers.length > 0) {
      try {
        const userIds = [...new Set(missingUsers.map(u => u.userId))]
        const userInfos = await safeGet(() =>
          db.collection('users').where(db.command.or([
            { openid: db.command.in(userIds) },
            { _id: db.command.in(userIds) }
          ])).field({ openid: true, _id: true, nickName: true, avatarUrl: true }).limit(200).get()
        )
        const userMap = {}
        for (const u of (userInfos.data || [])) {
          if (u.openid) userMap[u.openid] = u
          if (u._id) userMap[u._id] = u
        }
        for (const item of items) {
          const u = userMap[item.userId]
          if (u) {
            if (!item.nickName && u.nickName) item.nickName = u.nickName
            if (!item.avatarUrl && u.avatarUrl) item.avatarUrl = u.avatarUrl
          }
        }
      } catch (e) {
        console.warn('[Feedback] 查询 users 集合失败:', e.message)
      }
    }

    // 转换 cloud:// 头像 URL 为 HTTPS 可访问 URL
    await resolveFeedAvatars(items)

    res.json({
      success: true,
      items,
      pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) }
    })
  } catch (err) {
    console.error('[Feedback] list error:', err.message)
    res.status(500).json({ error: '获取反馈列表失败: ' + err.message })
  }
})

// PATCH /api/feedback/:id
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDB()
    const { id } = req.params
    const { status, adminNote } = req.body

    if (!id) return res.status(400).json({ error: '缺少反馈ID' })

    const updateData = { updatedAt: new Date() }
    if (status) {
      if (!['pending', 'resolved', 'closed'].includes(status)) {
        return res.status(400).json({ error: '无效的状态值' })
      }
      updateData.status = status
    }
    if (adminNote !== undefined) {
      if (typeof adminNote !== 'string' || adminNote.length > 500) {
        return res.status(400).json({ error: '管理员备注不能超过 500 个字符' })
      }
      updateData.adminNote = adminNote
    }

    await db.collection(COLL).doc(id).update({ data: updateData })

    res.json({ success: true, message: '反馈状态已更新' })
  } catch (err) {
    console.error('[Feedback] update error:', err.message)
    res.status(500).json({ error: '更新失败: ' + err.message })
  }
})

// DELETE /api/feedback/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDB()
    const { id } = req.params
    if (!id) return res.status(400).json({ error: '缺少反馈ID' })

    await db.collection(COLL).doc(id).remove()
    res.json({ success: true, message: '反馈已删除' })
  } catch (err) {
    console.error('[Feedback] delete error:', err.message)
    res.status(500).json({ error: '删除失败: ' + err.message })
  }
})

// GET /api/feedback/stats
router.get('/stats', async (req, res) => {
  try {
    const db = getDB()
    const [pendingR, resolvedR, closedR, totalR] = await Promise.all([
      safeGet(() => db.collection(COLL).where({ status: 'pending' }).count()),
      safeGet(() => db.collection(COLL).where({ status: 'resolved' }).count()),
      safeGet(() => db.collection(COLL).where({ status: 'closed' }).count()),
      safeGet(() => db.collection(COLL).count())
    ])

    // 评分统计：仅统计 score > 0 的反馈，聚合计算平均分与评分人数
    let avgScore = 0
    let ratedCount = 0
    try {
      const $ = db.command.aggregate
      const aggR = await safeGet(() =>
        db.collection(COLL).aggregate()
          .match({ score: db.command.gt(0) })
          .group({ _id: null, avgScore: $.avg('$score'), count: $.sum(1) })
          .end()
      )
      const rows = (aggR && (aggR.list || aggR.data)) || []
      if (rows.length > 0) {
        avgScore = Math.round((rows[0].avgScore || 0) * 10) / 10
        ratedCount = rows[0].count || 0
      }
    } catch (e) {
      console.warn('[Feedback] 评分聚合失败:', e.message)
    }

    res.json({
      success: true,
      stats: {
        pending: pendingR.total || 0,
        resolved: resolvedR.total || 0,
        closed: closedR.total || 0,
        total: totalR.total || 0,
        avgScore,
        ratedCount
      }
    })
  } catch (err) {
    console.error('[Feedback] stats error:', err.message)
    res.status(500).json({ error: '获取统计失败: ' + err.message })
  }
})

module.exports = router
