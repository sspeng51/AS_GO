/**
 * 用户信息一致性校验云函数
 *
 * 职责：每日凌晨比对三个场景的用户信息，生成不一致报告并自动修复
 *
 * 三个场景：
 *   1. 对话记录 (conversations 集合) - metadata.nickName, metadata.avatarUrl
 *   2. 用户反馈 (feedback 集合) - nickName, avatarUrl
 *   3. 用户主表 (users 集合) - nickName, avatarUrl (权威来源)
 *
 * 触发方式：定时触发器（每日凌晨 3:00 执行）
 * 手动触发：云函数控制台 → 测试调用
 */

const cloud = require('wx-server-sdk')
const { isAuthorizedInvocation } = require('./auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTIONS = {
  USERS: 'users',
  CONVERSATIONS: 'conversations',
  FEEDBACK: 'feedback'
}

const BATCH_SIZE = 100

exports.main = async (event, context) => {
  let openid = ''
  try {
    const wxContext = cloud.getWXContext() || {}
    openid = wxContext.OPENID || wxContext.openid || ''
  } catch (e) {}
  if (!isAuthorizedInvocation(event, openid, process.env.USER_CONSISTENCY_CHECK_SECRET)) {
    console.warn('[ConsistencyCheck] 拒绝未授权调用')
    return { success: false, error: '未授权访问' }
  }

  const report = {
    timestamp: new Date().toISOString(),
    summary: {},
    inconsistencies: [],
    autoFixed: [],
    errors: []
  }

  console.log('[ConsistencyCheck] 开始一致性校验...')

  try {
    // 1. 获取权威用户数据（users 集合）
    const userMap = await loadUserMap()
    report.summary.totalUsers = userMap.size
    console.log(`[ConsistencyCheck] 已加载 ${userMap.size} 个用户记录`)

    if (userMap.size === 0) {
      report.summary.status = 'no_users'
      console.log('[ConsistencyCheck] 无用户数据，跳过校验')
      return { success: true, report }
    }

    // 2. 校验 conversations 集合
    await checkConversations(userMap, report)

    // 3. 校验 feedback 集合
    await checkFeedback(userMap, report)

    // 4. 汇总
    report.summary.totalInconsistencies = report.inconsistencies
      .reduce((sum, item) => sum + (item.recordCount || 1), 0)
    report.summary.totalAutoFixed = report.autoFixed
      .reduce((sum, item) => sum + (item.recordCount || 1), 0)
    report.summary.status = report.summary.totalInconsistencies === 0
      ? 'consistent'
      : report.summary.totalAutoFixed === report.summary.totalInconsistencies
        ? 'fixed'
        : 'partially_fixed'

    console.log(`[ConsistencyCheck] 校验完成: 不一致 ${report.inconsistencies.length} 项, 已修复 ${report.autoFixed.length} 项`)
    return { success: true, report }
  } catch (err) {
    console.error('[ConsistencyCheck] 校验异常:', err.message)
    report.errors.push({ message: '一致性校验执行失败' })
    return { success: false, error: '一致性校验执行失败', report }
  }
}

/**
 * 加载 users 集合中的所有用户信息
 * 返回 Map<userId, { nickName, avatarUrl }>
 */
async function loadUserMap() {
  const userMap = new Map()
  let offset = 0
  let hasMore = true

  while (hasMore) {
    try {
      const res = await db.collection(COLLECTIONS.USERS)
        .field({ openid: true, _id: true, nickName: true, avatarUrl: true })
        .skip(offset)
        .limit(BATCH_SIZE)
        .get()

      const users = res.data || []
      for (const u of users) {
        const key = u.openid || u._id
        if (key) {
          userMap.set(key, {
            nickName: u.nickName || '微信用户',
            avatarUrl: u.avatarUrl || ''
          })
          // 也通过 _id 映射
          if (u._id && u._id !== key) {
            userMap.set(u._id, {
              nickName: u.nickName || '微信用户',
              avatarUrl: u.avatarUrl || ''
            })
          }
        }
      }

      hasMore = users.length >= BATCH_SIZE
      offset += BATCH_SIZE
    } catch (err) {
      console.warn('[ConsistencyCheck] 加载 users 集合出错:', err.message)
      break
    }
  }

  return userMap
}

/**
 * 校验 conversations 集合中的用户信息
 */
async function checkConversations(userMap, report) {
  console.log('[ConsistencyCheck] 开始校验 conversations 集合...')

  try {
    // 获取所有不同的 userId
    const userIds = await getDistinctUserIds(COLLECTIONS.CONVERSATIONS)
    console.log(`[ConsistencyCheck] conversations 中有 ${userIds.length} 个不同用户`)

    for (const userId of userIds) {
      const authority = userMap.get(userId)
      if (!authority) continue

      const result = await syncUserSnapshots(COLLECTIONS.CONVERSATIONS, userId, authority)
      if (result.mismatches > 0) {
        report.inconsistencies.push({
          collection: 'conversations',
          userId,
          authority: { nickName: authority.nickName, avatarUrl: authority.avatarUrl },
          current: result.sample,
          recordCount: result.mismatches
        })
        if (result.fixed > 0) {
          report.autoFixed.push({
            collection: 'conversations',
            userId,
            recordCount: result.fixed
          })
        }
        if (result.failed > 0) {
          report.errors.push({
            collection: 'conversations',
            userId,
            message: `${result.failed} 条记录自动修复失败`
          })
        }
      }
    }
  } catch (err) {
    console.warn('[ConsistencyCheck] 校验 conversations 出错:', err.message)
    report.errors.push({ collection: 'conversations', message: err.message })
  }
}

/**
 * 校验 feedback 集合中的用户信息
 */
async function checkFeedback(userMap, report) {
  console.log('[ConsistencyCheck] 开始校验 feedback 集合...')

  try {
    const userIds = await getDistinctUserIds(COLLECTIONS.FEEDBACK)
    console.log(`[ConsistencyCheck] feedback 中有 ${userIds.length} 个不同用户`)

    for (const userId of userIds) {
      const authority = userMap.get(userId)
      if (!authority) continue

      const result = await syncUserSnapshots(COLLECTIONS.FEEDBACK, userId, authority)
      if (result.mismatches > 0) {
        report.inconsistencies.push({
          collection: 'feedback',
          userId,
          authority: { nickName: authority.nickName, avatarUrl: authority.avatarUrl },
          current: result.sample,
          recordCount: result.mismatches
        })
        if (result.fixed > 0) {
          report.autoFixed.push({
            collection: 'feedback',
            userId,
            recordCount: result.fixed
          })
        }
        if (result.failed > 0) {
          report.errors.push({
            collection: 'feedback',
            userId,
            message: `${result.failed} 条记录自动修复失败`
          })
        }
      }
    }
  } catch (err) {
    console.warn('[ConsistencyCheck] 校验 feedback 出错:', err.message)
    report.errors.push({ collection: 'feedback', message: err.message })
  }
}

/**
 * 将某个用户在业务集合中的快照同步到 users 权威数据。
 * 逐条更新是为了保留 conversations.metadata 中的 source 等其他字段。
 */
async function syncUserSnapshots(collectionName, userId, authority) {
  let offset = 0
  let mismatches = 0
  let fixed = 0
  let failed = 0
  let sample = null

  while (true) {
    const query = db.collection(collectionName)
      .where({ userId })
      .field(collectionName === COLLECTIONS.CONVERSATIONS
        ? { metadata: true, _id: true }
        : { nickName: true, avatarUrl: true, _id: true })
      .skip(offset)
      .limit(BATCH_SIZE)
    const response = await query.get()
    const items = response.data || []
    if (items.length === 0) break

    const pending = []
    for (const item of items) {
      const current = collectionName === COLLECTIONS.CONVERSATIONS
        ? (item.metadata || {})
        : item
      const nickName = current.nickName || ''
      const avatarUrl = current.avatarUrl || ''
      if (nickName === authority.nickName && avatarUrl === authority.avatarUrl) continue

      mismatches += 1
      if (!sample) sample = { nickName, avatarUrl }
      const data = collectionName === COLLECTIONS.CONVERSATIONS
        ? {
            metadata: {
              ...(item.metadata || {}),
              nickName: authority.nickName,
              avatarUrl: authority.avatarUrl
            }
          }
        : {
            nickName: authority.nickName,
            avatarUrl: authority.avatarUrl,
            updatedAt: new Date()
          }
      pending.push(db.collection(collectionName).doc(item._id).update({ data }))
    }

    const results = await Promise.allSettled(pending)
    fixed += results.filter(result => result.status === 'fulfilled').length
    failed += results.filter(result => result.status === 'rejected').length

    offset += items.length
    if (items.length < BATCH_SIZE) break
  }

  return { mismatches, fixed, failed, sample }
}

/**
 * 获取集合中所有不同的 userId
 */
async function getDistinctUserIds(collectionName) {
  const userIds = new Set()
  let offset = 0
  let hasMore = true

  while (hasMore) {
    try {
      const res = await db.collection(collectionName)
        .field({ userId: true })
        .skip(offset)
        .limit(BATCH_SIZE)
        .get()

      const items = res.data || []
      for (const item of items) {
        if (item.userId) userIds.add(item.userId)
      }

      hasMore = items.length >= BATCH_SIZE
      offset += BATCH_SIZE
    } catch (err) {
      console.warn(`[ConsistencyCheck] 查询 ${collectionName} userId 出错:`, err.message)
      break
    }
  }

  return [...userIds]
}
