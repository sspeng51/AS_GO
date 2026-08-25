/**
 * 对话管理 API 路由
 *
 * 架构:
 *   - 小程序端 → processKnowledge 云函数写入对话数据（自动保存）
 *   - 后台 Server → @cloudbase/node-sdk 直接查询数据库
 */

const express = require('express')
const { getDB, resolveCloudFileURLs } = require('../utils/cloudbase')
const { authMiddleware, requireAdmin, requireStaff } = require('../middleware/auth')

const router = express.Router()
const COLL = 'conversations'

// 安全查询：集合不存在时返回空而非报错
async function safeGet(fn) {
  try { return await fn() }
  catch (err) {
    if (/not.exist/i.test(err.message) || ['DATABASE_COLLECTION_NOT_EXIST','RESOURCE_NOT_FOUND'].includes(err.code))
      return { data: [], total: 0 }
    throw err
  }
}

/**
 * 将数据中的 cloud:// 头像 URL 批量转换为可访问的 HTTPS URL
 * @param {Array} items - 包含 avatarUrl 字段的对象数组
 * @param {string} key - avatarUrl 的字段路径（默认 'avatarUrl'）
 * @param {Function} getter - 自定义获取 avatarUrl 的函数
 * @param {Function} setter - 自定义设置 avatarUrl 的函数
 */
async function resolveAvatars(items, key = 'avatarUrl', getter, setter) {
  const cloudIds = []
  for (const item of items) {
    let url = ''
    if (getter) url = getter(item)
    else url = item[key] || ''
    if (url && typeof url === 'string' && url.startsWith('cloud://')) cloudIds.push(url)
  }
  if (cloudIds.length === 0) return
  
  const urlMap = await resolveCloudFileURLs(cloudIds)
  if (urlMap.size === 0) return
  
  for (const item of items) {
    let url = getter ? getter(item) : (item[key] || '')
    if (url && urlMap.has(url)) {
      if (setter) setter(item, urlMap.get(url))
      else item[key] = urlMap.get(url)
    }
  }
}

router.use(authMiddleware, requireStaff)

// ====== 同步状态诊断端点 ======
router.post('/sync-status', requireAdmin, async (req, res) => {
  const db = getDB()
  const result = {
    collectionExists: false,
    documentCount: 0,
    latestMessage: null,
    canRead: false,
    canWrite: false,
    errors: []
  }

  // 1. 检查集合是否存在并读取
  try {
    const count = await db.collection(COLL).count()
    result.collectionExists = true
    result.documentCount = count.total || 0
    result.canRead = true
  } catch (err) {
    if (/not.exist/i.test(err.message) || ['DATABASE_COLLECTION_NOT_EXIST', 'RESOURCE_NOT_FOUND'].includes(err.code)) {
      result.collectionExists = false
      result.errors.push(`集合不存在: ${err.message?.substring(0, 100)}`)
    } else {
      result.errors.push(`读取失败: ${err.message?.substring(0, 100)}`)
    }
  }

  // 2. 获取最新一条消息
  if (result.collectionExists && result.documentCount > 0) {
    try {
      const latest = await db.collection(COLL).orderBy('timestamp', 'desc').limit(1).get()
      if (latest.data && latest.data.length > 0) {
        const m = latest.data[0]
        result.latestMessage = {
          id: m._id,
          userId: m.userId,
          direction: m.direction,
          contentPreview: (m.content || '').substring(0, 50),
          timestamp: m.timestamp,
          hasMetadata: !!(m.metadata && (m.metadata.nickName || m.metadata.avatarUrl))
        }
      }
    } catch (err) {
      result.errors.push(`获取最新消息失败: ${err.message?.substring(0, 100)}`)
    }
  }

  // 3. 写入测试
  try {
    const testId = `sync_test_${Date.now()}`
    await db.collection(COLL).add({
      data: {
        _id: testId,
        userId: '_sync_diag',
        sessionId: '_sync_diag_session',
        direction: 'system',
        content: `[同步诊断] ${new Date().toISOString()}`,
        messageType: 'text',
        timestamp: new Date(),
        metadata: { source: 'sync_diagnostic' },
        createdAt: new Date()
      }
    })
    result.canWrite = true
    // 清理
    await db.collection(COLL).doc(testId).remove()
  } catch (err) {
    result.errors.push(`写入失败: ${err.message?.substring(0, 100)}`)
  }

  res.json({ success: true, ...result })
})

// ====== 诊断接口：测试写入链路 ======
router.post('/diagnose', requireAdmin, async (req, res) => {
  const db = getDB()
  const result = { steps: [], success: false, data: null }

  // Step 1: 尝试读取集合
  try {
    const count = await db.collection(COLL).count()
    result.steps.push({ step: 'read', status: 'ok', detail: `当前记录数: ${count.total}` })
  } catch (err) {
    result.steps.push({ step: 'read', status: err.code || 'error', detail: err.message?.substring(0, 200) })
  }

  // Step 2: 尝试写入测试记录
  try {
    const testId = `diag_${Date.now()}`
    const writeRes = await db.collection(COLL).add({
      data: {
        _id: testId,
        userId: '_diagnostic_test',
        sessionId: '_diagnostic_session',
        direction: 'user',
        content: `[诊断测试] ${new Date().toISOString()}`,
        messageType: 'text',
        timestamp: new Date(),
        metadata: { source: 'server_diagnose' },
        createdAt: new Date()
      }
    })
    result.steps.push({ step: 'write', status: 'ok', detail: `写入成功, id=${testId}` })

    // Step 3: 立即读回验证
    try {
      const readBack = await db.collection(COLL).doc(testId).get()
      result.steps.push({ step: 'verify', status: 'ok', detail: '读写验证通过' })
      result.success = true
      result.data = readBack.data

      // 清理测试数据
      await db.collection(COLL).doc(testId).remove()
      result.steps.push({ step: 'cleanup', status: 'ok', detail: '测试数据已清理' })
    } catch (vErr) {
      result.steps.push({ step: 'verify', status: 'error', detail: vErr.message?.substring(0, 200) })
    }
  } catch (writeErr) {
    result.steps.push({ step: 'write', status: 'error', detail: writeErr.message?.substring(0, 200), code: writeErr.code })
  }

  res.json(result)
})

// GET /api/conversations/users
router.get('/users', async (req, res) => {
  try {
    const db = getDB()
    const r = await safeGet(() => db.collection(COLL).field({ userId:true, timestamp:true, metadata:true }).orderBy('timestamp','desc').limit(1000).get())
    const messages = r.data || []
    const seen = new Set()
    const users = []

    for (const msg of messages) {
      if (seen.has(msg.userId)) continue
      seen.add(msg.userId)

      // 尝试从消息 metadata 中获取用户信息（小程序端已携带）
      const meta = msg.metadata || {}
      users.push({
        userId: msg.userId,
        lastActiveTime: msg.timestamp,
        nickName: meta.nickName || '',
        avatarUrl: meta.avatarUrl || ''
      })
    }

    // 批量查询 users 集合补充缺失的用户信息（昵称或头像为空时都补，与反馈逻辑一致）
    const missingUsers = users.filter(u => u.userId && (!u.nickName || !u.avatarUrl))
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
        for (const u of users) {
          const info = userMap[u.userId]
          if (info) {
            if (!u.nickName && info.nickName) u.nickName = info.nickName
            if (!u.avatarUrl && info.avatarUrl) u.avatarUrl = info.avatarUrl
          }
        }
        console.log(`[Conversations] users 集合补充了 ${missingUsers.length} 个用户信息`)
      } catch (e) {
        console.warn('[Conversations] 查询 users 集合失败:', e.message)
      }
    }

    // 转换 cloud:// 头像 URL 为 HTTPS 可访问 URL
    await resolveAvatars(users)

    res.json({ success: true, users, total: users.length })
  } catch (err) {
    console.error('[Conversations] users error:', err.message)
    res.status(500).json({ error: '获取用户列表失败: ' + err.message })
  }
})

// GET /api/conversations/sessions
router.get('/sessions', async (req, res) => {
  try {
    const db = getDB()
    const { userId, dateFrom, dateTo } = req.query
    const p = Math.max(1, parseInt(req.query.page, 10) || 1)
    const ps = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
    const where = userId ? { userId } : {}
    const fromDate = dateFrom ? new Date(dateFrom) : null
    const toDate = dateTo ? new Date(dateTo) : null
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
      return res.status(400).json({ error: '日期格式无效' })
    }
    if (fromDate) where.timestamp = db.command.gte(fromDate)
    if (toDate) {
      toDate.setHours(23, 59, 59, 999)
      where.timestamp = fromDate
        ? db.command.and(db.command.gte(fromDate), db.command.lte(toDate))
        : db.command.lte(toDate)
    }
    const r = await safeGet(() => db.collection(COLL).where(where).orderBy('timestamp','desc').limit(1000).get())
    const raw = r.data || []

    // 按“用户 + sessionId”聚合，避免不同账号复用了同一个本地 sessionId 时串话。
    // 旧记录缺少 sessionId 时保留 recordId，详情接口可按文档 ID 精确读取。
    const m = new Map()
    for (const msg of raw) {
      const hasSessionId = Boolean(msg.sessionId)
      const sid = msg.sessionId || msg._id || `_unknown_${m.size}`
      const uid = msg.userId || ''
      const groupKey = hasSessionId ? `${uid}\u0000${sid}` : `legacy\u0000${msg._id}`
      if (!m.has(groupKey)) m.set(groupKey, {
        sessionId: sid,
        userId: uid,
        recordId: hasSessionId ? '' : msg._id,
        firstMessageTime: msg.timestamp,
        lastMessageTime: msg.timestamp,
        messageCount: 0,
        lastMessage: '',
        nickName: '',
        avatarUrl: ''
      })
      const s = m.get(groupKey); s.messageCount++
      const t = new Date(msg.timestamp)
      if (t < new Date(s.firstMessageTime)) s.firstMessageTime = msg.timestamp
      // 修复：小程序保存一轮对话时 user/ai 消息使用同一时间戳，
      // 严格 > 会导致 lastMessage 永远为空。改为：时间戳相等时也更新，
      // 且优先保留 ai 消息作为最后一条（一轮对话中 AI 回复通常是最后一条）
      const tMs = t.getTime()
      const lastMs = new Date(s.lastMessageTime).getTime()
      if (!s.lastMessage || tMs > lastMs || (tMs === lastMs && msg.direction === 'ai')) {
        s.lastMessageTime = msg.timestamp
        s.lastMessage = (msg.content || '').substring(0, 100)
      }
      // 取最新的用户消息的 nickName/avatarUrl
      const meta = msg.metadata || {}
      if (msg.direction === 'user' && meta.nickName && !s.nickName) s.nickName = meta.nickName
      if (msg.direction === 'user' && meta.avatarUrl && !s.avatarUrl) s.avatarUrl = meta.avatarUrl
    }

    const sessions = [...m.values()].sort((a,b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime))
    const total = sessions.length
    const pagedSessions = sessions.slice((p - 1) * ps, p * ps)

    // 补充查询 users 集合：会话聚合时 metadata 可能缺失头像/昵称
    const sessionsMissingInfo = pagedSessions.filter(s => s.userId && (!s.nickName || !s.avatarUrl))
    if (sessionsMissingInfo.length > 0) {
      try {
        const sessionUserIds = [...new Set(sessionsMissingInfo.map(s => s.userId))]
        const sessionUserInfos = await safeGet(() =>
          db.collection('users').where(db.command.or([
            { openid: db.command.in(sessionUserIds) },
            { _id: db.command.in(sessionUserIds) }
          ])).field({ openid: true, _id: true, nickName: true, avatarUrl: true }).limit(200).get()
        )
        const suMap = {}
        for (const u of (sessionUserInfos.data || [])) {
          if (u.openid) suMap[u.openid] = u
          if (u._id) suMap[u._id] = u
        }
        for (const s of pagedSessions) {
          const info = suMap[s.userId]
          if (info) {
            if (!s.nickName && info.nickName) s.nickName = info.nickName
            if (!s.avatarUrl && info.avatarUrl) s.avatarUrl = info.avatarUrl
          }
        }
      } catch (e) {
        console.warn('[Conversations] sessions users 集合补充失败:', e.message)
      }
    }

    // 转换 cloud:// 头像 URL
    await resolveAvatars(pagedSessions)

    res.json({ success:true, sessions: pagedSessions, pagination:{page:p,pageSize:ps,total,totalPages:Math.ceil(total/ps)} })
  } catch (err) {
    console.error('[Conversations] sessions error:', err.message)
    res.status(500).json({ error: '获取会话列表失败: ' + err.message })
  }
})

// GET /api/conversations/messages
router.get('/messages', async (req, res) => {
  try {
    const db = getDB()
    const { userId, sessionId, recordId, dateFrom, dateTo } = req.query
    const p = Math.max(1, parseInt(req.query.page, 10) || 1)
    const ps = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50))
    console.log('[Conversations] messages query:', JSON.stringify({ userId, sessionId, page, pageSize }).substring(0, 200))

    if (!sessionId && !recordId) return res.status(400).json({ error: '缺少 sessionId 或 recordId', receivedParams: req.query })

    // 新记录按“用户 + sessionId”读取；旧记录可按 recordId 精确读取。
    const where = {}
    if (recordId) where._id = recordId
    else if (sessionId) where.sessionId = sessionId
    if (userId) where.userId = userId
    const fromDate = dateFrom ? new Date(dateFrom) : null
    const toDate = dateTo ? new Date(dateTo) : null
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
      return res.status(400).json({ error: '日期格式无效' })
    }
    if (fromDate) where.timestamp = db.command.gte(fromDate)
    if (toDate) {
      toDate.setHours(23,59,59,999)
      where.timestamp = fromDate
        ? db.command.and(db.command.gte(fromDate), db.command.lte(toDate))
        : db.command.lte(toDate)
    }

    const countR = await safeGet(() => db.collection(COLL).where(where).count())
    const total = countR.total || 0
    const listR = await safeGet(() => db.collection(COLL).where(where).orderBy('timestamp','asc').skip((p-1)*ps).limit(ps).get())

    const messages = (listR.data||[]).map(m => ({ id:m._id, userId:m.userId, sessionId:m.sessionId, direction:m.direction, content:m.content, messageType:m.messageType||'text', timestamp:m.timestamp, metadata:m.metadata||{}, createdAt:m.createdAt }))

    // 补充查询 users 集合：消息 metadata 中可能缺失头像/昵称
    const msgMissingInfo = messages.filter(m => m.userId && m.direction === 'user' && (!m.metadata?.nickName || !m.metadata?.avatarUrl))
    if (msgMissingInfo.length > 0) {
      try {
        const msgUserIds = [...new Set(msgMissingInfo.map(m => m.userId))]
        const msgUserInfos = await safeGet(() =>
          db.collection('users').where(db.command.or([
            { openid: db.command.in(msgUserIds) },
            { _id: db.command.in(msgUserIds) }
          ])).field({ openid: true, _id: true, nickName: true, avatarUrl: true }).limit(200).get()
        )
        const muMap = {}
        for (const u of (msgUserInfos.data || [])) {
          if (u.openid) muMap[u.openid] = u
          if (u._id) muMap[u._id] = u
        }
        for (const msg of messages) {
          if (msg.direction !== 'user') continue
          const info = muMap[msg.userId]
          if (info && msg.metadata) {
            if (!msg.metadata.nickName && info.nickName) msg.metadata.nickName = info.nickName
            if (!msg.metadata.avatarUrl && info.avatarUrl) msg.metadata.avatarUrl = info.avatarUrl
          }
        }
      } catch (e) {
        console.warn('[Conversations] messages users 集合补充失败:', e.message)
      }
    }

    // 转换消息 metadata 中的 cloud:// 头像 URL
    await resolveAvatars(messages, null, msg => (msg.metadata && msg.metadata.avatarUrl) || '', (msg, url) => { if (msg.metadata) msg.metadata.avatarUrl = url })

    res.json({ success:true, messages, pagination:{page:p,pageSize:ps,total,totalPages:Math.ceil(total/ps)} })
  } catch (err) {
    console.error('[Conversations] messages error:', err.message)
    res.status(500).json({ error: '获取消息列表失败: ' + err.message })
  }
})

// DELETE /api/conversations/sessions
router.delete('/sessions', requireAdmin, async (req, res) => {
  try {
    const db = getDB()
    const { userId, sessionId } = req.body
    if (!userId) return res.status(400).json({ error: '缺少 userId' })
    if (!sessionId) return res.status(400).json({ error: '缺少 sessionId' })

    const countR = await safeGet(() => db.collection(COLL).where({userId,sessionId}).count())
    const total = countR.total || 0
    let deleted = 0
    if (total > 0) {
      const rm = await db.collection(COLL).where({userId,sessionId}).remove()
      deleted = rm.stats?.removed || rm.deleted || 0
    }
    console.log(`[Conversations] delete: userId=${userId}, deleted=${deleted}`)
    res.json({ success:true, deletedCount:deleted, message: deleted>0 ? `成功删除 ${deleted} 条消息` : '会话无消息记录' })
  } catch (err) {
    console.error('[Conversations] delete error:', err.message)
    res.status(500).json({ error: '删除会话失败: ' + err.message })
  }
})

module.exports = router
