const path = require('path')
const bcrypt = require('bcryptjs')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const { initCloudBase, getDB, COLLECTIONS } = require('../utils/cloudbase')

async function main() {
  const username = String(process.env.ADMIN_USERNAME || '').trim()
  const password = String(process.env.ADMIN_PASSWORD || '')

  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    throw new Error('请先在 .env 配置 3-32 位 ADMIN_USERNAME（字母、数字或 _.-）')
  }
  if (password.length < 12 || /please-change|change.?me|example|default/i.test(password)) {
    throw new Error('请先在 .env 配置至少 12 位 ADMIN_PASSWORD')
  }

  await initCloudBase()
  const db = getDB()
  const existing = await db.collection(COLLECTIONS.USERS)
    .where({ username })
    .limit(1)
    .get()

  if (existing.data && existing.data.length > 0) {
    throw new Error(`账号 ${username} 已存在；为避免覆盖密码，初始化已取消`)
  }

  const now = new Date()
  const hashedPassword = await bcrypt.hash(password, 12)
  await db.collection(COLLECTIONS.USERS).add({
    username,
    password: hashedPassword,
    nickname: '系统管理员',
    role: 'admin',
    status: 'active',
    createdAt: now,
    updatedAt: now
  })

  console.log(`管理员 ${username} 已创建。建议从 .env 移除 ADMIN_PASSWORD 后再启动服务。`)
}

main().catch(error => {
  console.error('[CreateAdmin]', error.message)
  process.exitCode = 1
})
