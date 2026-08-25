const cloudbase = require('@cloudbase/node-sdk')

let app = null
let db = null
let initialized = false
let initError = null
let verifiedEnvId = null
const fileUrlCache = new Map()
const FILE_URL_CACHE_TTL = 50 * 60 * 1000
const FILE_URL_CACHE_MAX = 500

const COLLECTIONS = {
  USERS: 'users'
}

async function testConnection(testDb, envLabel) {
  try {
    const result = await testDb.collection(COLLECTIONS.USERS).limit(1).get()
    console.log(`[CloudBase] ✅ ${envLabel} 连接测试成功, 数据量: ${result.data?.length || 0}`)
    return { success: true, dataCount: result.data?.length || 0 }
  } catch (err) {
    // 集合不存在说明连接是通的（凭据正确），自动创建集合
    const isCollectionNotExist = err.code === 'DATABASE_COLLECTION_NOT_EXIST' || /not exist/i.test(err.message || '')
    if (isCollectionNotExist) {
      console.log(`[CloudBase] ℹ️ ${envLabel} 连接成功，但 users 集合不存在，尝试自动创建...`)
      try {
        await testDb.createCollection(COLLECTIONS.USERS)
        console.log(`[CloudBase] ✅ ${envLabel} 已自动创建 users 集合，连接成功`)
        return { success: true, dataCount: 0, createdCollection: true }
      } catch (createErr) {
        // 创建失败（可能是权限不足），但凭据是对的，仍视为连接成功
        console.warn(`[CloudBase] ⚠️ ${envLabel} 自动创建 users 集合失败（权限不足？），但凭据有效，视为连接成功`)
        return { success: true, dataCount: 0, createFailed: true }
      }
    }
    console.log(`[CloudBase] ❌ ${envLabel} 连接失败:`, err.message?.substring(0, 150))
    return { success: false, error: err.message, code: err.code }
  }
}

// 确保所有业务集合存在（首次使用时自动创建，已存在则忽略）
async function ensureBusinessCollections(db) {
  const collections = ['users', 'rag_config', 'conversations', 'feedback']
  const created = []
  for (const name of collections) {
    try {
      await db.createCollection(name)
      created.push(name)
    } catch (e) {
      // 集合已存在或权限不足，忽略
    }
  }
  if (created.length > 0) {
    console.log(`[CloudBase] 📦 自动创建集合: ${created.join(', ')}`)
  }
}

async function initCloudBase() {
  if (initialized) {
    if (initError) throw initError
    console.log('[CloudBase] ♻️ 复用已初始化实例, 环境:', verifiedEnvId)
    return { app, db }
  }

  initialized = true

  const envId = process.env.CLOUDBASE_ENV_ID || 'cloud1-6gbzplmt4a3dc5b5'
  const accessKey = process.env.CLOUDBASE_ACCESS_KEY
  const secretId = process.env.CLOUDBASE_SECRET_ID
  const secretKey = process.env.CLOUDBASE_SECRET_KEY

  console.log('[CloudBase] 🔄 开始初始化...')
  console.log('[CloudBase] 环境ID:', envId)
  console.log('[CloudBase] 认证方式:', accessKey ? 'API Key (accessKey)' : (secretId ? 'SecretId/SecretKey' : '无'))

  if (!accessKey && (!secretId || !secretKey)) {
    console.warn('[CloudBase] ⚠️ 未配置任何认证凭据')
    console.warn('[CloudBase] 需要在 .env 中配置 CLOUDBASE_ACCESS_KEY 或 CLOUDBASE_SECRET_ID/SECRET_KEY')
    initError = new Error('CLOUDBASE_NOT_CONFIGURED')
    return { app: null, db: null }
  }

  const strategies = []

  if (accessKey) {
    strategies.push({
      name: 'API Key 认证',
      config: { env: envId, accessKey },
      envLabel: `${envId}(API Key)`
    })
  }

  if (secretId && secretKey) {
    strategies.push({
      name: 'SecretId/SecretKey 指定环境',
      config: { env: envId, secretId, secretKey },
      envLabel: `${envId}(Secret)`
    })
    strategies.push({
      name: 'SecretId/SecretKey 默认环境',
      config: { secretId, secretKey },
      envLabel: 'auto-default'
    })
  }

  for (const strategy of strategies) {
    try {
      console.log(`[CloudBase] 🔧 尝试策略: ${strategy.name}`)
      
      const testApp = cloudbase.init(strategy.config)
      const testDb = testApp.database()
      
      const testResult = await testConnection(testDb, strategy.name)
      
      if (testResult.success) {
        app = testApp
        db = testDb
        verifiedEnvId = envId

        // 确保所有业务集合存在（首次使用时自动创建）
        await ensureBusinessCollections(db)

        console.log(`[CloudBase] ✅ 初始化成功! 策略: ${strategy.name}`)
        console.log(`[CloudBase] ✅ 实际环境: ${verifiedEnvId}`)
        return { app, db }
      }
    } catch (err) {
      console.warn(`[CloudBase] ⚠️ 策略 ${strategy.name} 异常:`, err.message?.substring(0, 100))
    }
  }

  console.error('[CloudBase] ❌ 所有策略均失败!')
  initError = new Error('所有连接策略均失败，请检查凭据是否正确')
  return { app: null, db: null }
}

function getDB() {
  if (!initialized) throw new Error('CloudBase 未初始化，请等待启动完成')
  if (initError) throw initError
  if (!db) throw new Error('CloudBase 数据库未初始化')
  return db
}

function getDBOrNull() {
  if (!initialized) return null
  return initError ? null : db
}

function getApp() {
  if (!initialized) throw new Error('CloudBase 未初始化')
  if (initError) throw initError
  return app
}

function isReady() {
  return initialized && !initError && !!db
}

function getStatus() {
  return {
    ready: isReady(),
    initialized,
    hasError: !!initError,
    error: initError ? initError.message : null,
    envId: process.env.CLOUDBASE_ENV_ID || 'cloud1-6gbzplmt4a3dc5b5',
    verifiedEnvId: verifiedEnvId,
    authMethod: process.env.CLOUDBASE_ACCESS_KEY ? 'API Key' : (process.env.CLOUDBASE_SECRET_ID ? 'Secret' : 'none')
  }
}

/**
 * 将 cloud:// 文件 ID 批量转换为可访问的 HTTPS URL
 * 策略：优先使用 SDK getTempFileURL，失败时用字符串构造兜底
 * @param {string[]} fileIds - 文件 ID 数组（可能包含 cloud:// 和其他格式）
 * @returns {Promise<Map<string, string>>} fileID → httpsURL 的映射
 */
async function resolveCloudFileURLs(fileIds) {
  const cloudIds = [...new Set(fileIds.filter(id => id && typeof id === 'string' && id.startsWith('cloud://')))]
  if (cloudIds.length === 0) return new Map()

  const map = new Map()
  const failed = []
  const now = Date.now()
  const unresolved = []
  for (const fileId of cloudIds) {
    const cached = fileUrlCache.get(fileId)
    if (cached && cached.expiresAt > now) map.set(fileId, cached.url)
    else {
      fileUrlCache.delete(fileId)
      unresolved.push(fileId)
    }
  }
  if (unresolved.length === 0) return map

  // 策略 1：使用 SDK getTempFileURL（获取临时下载链接，带签名）
  try {
    const tcbApp = getApp()
    const result = await tcbApp.getTempFileURL({ fileList: unresolved })
    for (const item of (result.fileList || [])) {
      if (item.tempFileURL) {
        map.set(item.fileID, item.tempFileURL)
        fileUrlCache.set(item.fileID, {
          url: item.tempFileURL,
          expiresAt: now + FILE_URL_CACHE_TTL
        })
      } else {
        failed.push(item.fileID)
      }
    }
    console.log(`[CloudBase] getTempFileURL 新解析: ${unresolved.length - failed.length}/${unresolved.length} 个`)
  } catch (e) {
    console.warn('[CloudBase] getTempFileURL 调用异常:', e.message)
    failed.push(...unresolved)
  }

  // 策略 2：对失败的 cloud:// URL 用字符串构造 https:// URL 兜底
  // 格式: cloud://env-id.xxx/path → https://env-id.tcb.qcloud.la/path
  for (const cloudId of failed) {
    try {
      const httpsUrl = _cloudUrlToHttp(cloudId)
      if (httpsUrl) {
        map.set(cloudId, httpsUrl)
        fileUrlCache.set(cloudId, {
          url: httpsUrl,
          expiresAt: now + FILE_URL_CACHE_TTL
        })
      }
    } catch (e) {
      console.warn('[CloudBase] 兜底 URL 构造失败:', e.message)
    }
  }

  while (fileUrlCache.size > FILE_URL_CACHE_MAX) {
    fileUrlCache.delete(fileUrlCache.keys().next().value)
  }
  return map
}

/**
 * cloud:// 转 https:// 的字符串构造兜底
 * cloud://env-id.appid-env-id-bucket/path → https://env-id.tcb.qcloud.la/path
 */
function _cloudUrlToHttp(cloudUrl) {
  // 格式: cloud://env-id.appid-env-id-bucket-id/path/to/file
  const match = cloudUrl.match(/^cloud:\/\/([^.]+)\.(.+?)\/(.+)$/)
  if (!match) return null
  const envId = match[1]     // 环境 ID
  const path = match[3]      // 文件路径
  return `https://${envId}.tcb.qcloud.la/${path}`
}

module.exports = {
  COLLECTIONS,
  initCloudBase,
  getDB,
  getDBOrNull,
  getApp,
  isReady,
  getStatus,
  resolveCloudFileURLs
}
