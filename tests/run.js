const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const { chunkText } = require('../cloudfunctions/processKnowledge/lib/textChunker')
const { cosineSimilarity, search } = require('../cloudfunctions/processKnowledge/lib/vectorSearch')
const { markdownToHtml } = require('../utils/markdownParser')
const Utf8StreamDecoder = require('../utils/utf8StreamDecoder')
const { ownerSegment, getCloudPath, isOwnedFile, isOwnedChatAttachment, isOwnedByAny } = require('../cloudfunctions/processKnowledge/lib/attachmentOwnership')
const { getChatUsageLimits, evaluateUsage } = require('../cloudfunctions/processKnowledge/lib/usagePolicy')
const { createStreamToken } = require('../cloudfunctions/processKnowledge/lib/streamToken')
const { getFileType } = require('../cloudfunctions/processKnowledge/lib/fileParser')
const { isRetryableRerankFailure } = require('../cloudfunctions/processKnowledge/lib/retrievalFallback')
const { verifyStreamToken } = require('../web-admin/server/utils/streamToken')
const { isAuthorizedInvocation } = require('../cloudfunctions/userConsistencyCheck/auth')
const clientConfig = require('../config/config')
const cloudConfig = require('../cloudfunctions/processKnowledge/config')
const { appendWithoutOverlap, continuationMessages } = require('../utils/continuation')

function test(name, fn) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    throw error
  }
}

test('长文本按限制切分并保留重叠上下文', () => {
  const chunks = chunkText('甲'.repeat(1200), { chunkSize: 500, overlap: 100, minChunkSize: 1 })
  assert.strictEqual(chunks.length, 3)
  assert.ok(chunks.every(chunk => chunk.length <= 500))
  assert.strictEqual(chunks[0].slice(-100), chunks[1].slice(0, 100))
})

test('Markdown 代码块整体保留', () => {
  const source = '# 标题\n\n```js\nconst answer = 42\n```'
  const chunks = chunkText(source, { chunkSize: 10, overlap: 2, minChunkSize: 1 })
  assert.ok(chunks.some(chunk => chunk.includes('const answer = 42')))
})

test('余弦相似度和向量排序正确', () => {
  assert.strictEqual(cosineSimilarity([1, 0], [1, 0]), 1)
  assert.strictEqual(cosineSimilarity([1, 0], [0, 1]), 0)
  const result = search([1, 0], [
    { _id: 'low', embedding: [0, 1], text: '低' },
    { _id: 'high', embedding: [1, 0], text: '高' }
  ], 1)
  assert.strictEqual(result[0].chunkId, 'high')
})

test('Markdown 输出会转义原始 HTML', () => {
  const html = markdownToHtml('<script>alert(1)</script> **安全**')
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('<strong>安全</strong>'))
})

test('UTF-8 流式解码支持中文和 emoji 跨分块', () => {
  const source = '砷智答 🧪 UTF-8'
  const bytes = Buffer.from(source, 'utf8')
  for (let split = 1; split < bytes.length; split++) {
    const decoder = new Utf8StreamDecoder()
    const decoded = decoder.decode(bytes.subarray(0, split)) +
      decoder.decode(bytes.subarray(split)) + decoder.decode(new Uint8Array(0), true)
    assert.strictEqual(decoded, source, `split=${split}`)
  }
})

test('续答仅拼接未重叠部分，并且不写入原始消息', () => {
  assert.strictEqual(appendWithoutOverlap('第一段结尾', '结尾第二段'), '第一段结尾第二段')
  assert.strictEqual(appendWithoutOverlap('甲'.repeat(500), '甲'.repeat(400) + '乙'), '甲'.repeat(500) + '乙')
  const original = [{ role: 'user', content: '问题' }]
  const result = continuationMessages(original, '已生成部分')
  assert.deepStrictEqual(original, [{ role: 'user', content: '问题' }])
  assert.strictEqual(result[result.length - 1].role, 'user')
  assert.ok(result[result.length - 1].content.includes('不要重复'))
})

test('聊天附件只能从当前用户专属路径读取', () => {
  const userId = 'user/unsafe:id'
  const segment = ownerSegment(userId)
  const owned = `cloud://env.bucket/chat-attachments/${segment}/report.pdf`
  const foreign = 'cloud://env.bucket/chat-attachments/another-user/report.pdf'
  assert.strictEqual(getCloudPath(owned), `chat-attachments/${segment}/report.pdf`)
  assert.strictEqual(isOwnedChatAttachment(owned, userId), true)
  assert.strictEqual(isOwnedChatAttachment(foreign, userId), false)
  assert.strictEqual(isOwnedChatAttachment('https://example.com/report.pdf', userId), false)
  assert.strictEqual(isOwnedFile(`cloud://env.bucket/personal-kb/${segment}/paper.pdf`, userId, 'personal-kb'), true)
  assert.strictEqual(isOwnedFile(`cloud://env.bucket/personal-kb/other/paper.pdf`, userId, 'personal-kb'), false)
  assert.strictEqual(isOwnedByAny(owned, ['database-user-id', userId], 'chat-attachments'), true)
  assert.strictEqual(isOwnedByAny(foreign, ['database-user-id', userId], 'chat-attachments'), false)
})

test('取消生成后保持中止状态，直到下一次请求显式重置', () => {
  const manager = require('../utils/chatStreamManager')
  let aborted = false
  manager.resetAbort()
  manager.setCloudTask({ abort: () => { aborted = true } })
  manager.cancel()
  assert.strictEqual(aborted, true)
  assert.strictEqual(manager.isAborted(), true)

  manager.setCloudTask({ abort: () => {} })
  assert.strictEqual(manager.isAborted(), true)
  manager.clearCloudTask()
  manager.resetAbort()
  assert.strictEqual(manager.isAborted(), false)
})

test('常见图片格式进入视觉识别流程', () => {
  for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']) {
    assert.strictEqual(getFileType(ext), 'image')
  }
  const parser = fs.readFileSync(path.join(root, 'cloudfunctions/processKnowledge/lib/fileParser.js'), 'utf8')
  assert.ok(parser.includes("type: 'image_url'"))
  assert.ok(parser.includes("'glm-4v-flash'"))
})

test('智谱重排服务异常时允许关闭重排自动降级', () => {
  assert.strictEqual(isRetryableRerankFailure(500, '知识召回服务异常'), true)
  assert.strictEqual(isRetryableRerankFailure('500', 'rerank service unavailable'), true)
  assert.strictEqual(isRetryableRerankFailure(400, '参数错误'), false)
  assert.strictEqual(isRetryableRerankFailure(500, '鉴权失败'), false)
})

test('流式令牌具备签名、短有效期和防篡改能力', () => {
  const secret = 's'.repeat(48)
  const token = createStreamToken(secret, 'user-123', 120)
  const claims = verifyStreamToken(token, secret)
  assert.strictEqual(claims.sub, 'user-123')
  assert.ok(claims.jti)
  assert.throws(() => verifyStreamToken(token + 'x', secret), /无效/)
  assert.throws(() => verifyStreamToken(token, secret, claims.exp + 1), /过期/)
})

test('一致性修复只允许可信定时器或管理密钥', () => {
  const secret = 'k'.repeat(48)
  assert.strictEqual(isAuthorizedInvocation({ Type: 'Timer', Time: '2026-08-11T03:00:00Z' }, '', secret), true)
  assert.strictEqual(isAuthorizedInvocation({ Type: 'Timer', Time: '2026-08-11T03:00:00Z' }, 'attacker-openid', secret), false)
  assert.strictEqual(isAuthorizedInvocation({ adminSecret: secret }, 'admin-openid', secret), true)
  assert.strictEqual(isAuthorizedInvocation({ adminSecret: 'wrong' }, '', secret), false)
})

test('AI 调用限额覆盖游客、注册用户和分钟窗口', () => {
  const env = {
    GUEST_DAILY_LIMIT: '2',
    GUEST_PER_MINUTE_LIMIT: '1',
    REGISTERED_DAILY_LIMIT: '5',
    REGISTERED_PER_MINUTE_LIMIT: '2'
  }
  assert.deepStrictEqual(getChatUsageLimits(false, env), { daily: 2, perMinute: 1 })
  assert.deepStrictEqual(getChatUsageLimits(true, env), { daily: 5, perMinute: 2 })

  const first = evaluateUsage(null, '2026-08-11T12:00', { daily: 2, perMinute: 1 })
  assert.strictEqual(first.allowed, true)
  assert.deepStrictEqual(first.next, { count: 1, minuteWindow: '2026-08-11T12:00', minuteCount: 1 })
  assert.strictEqual(evaluateUsage(first.next, '2026-08-11T12:00', { daily: 2, perMinute: 1 }).allowed, false)
  assert.strictEqual(evaluateUsage(first.next, '2026-08-11T12:01', { daily: 2, perMinute: 1 }).allowed, true)
  assert.strictEqual(evaluateUsage({ ...first.next, count: 2 }, '2026-08-11T12:01', { daily: 2, perMinute: 1 }).allowed, false)
})

test('客户端与云函数默认模型保持一致', () => {
  assert.strictEqual(clientConfig.zhipu.model, cloudConfig.zhipu.model)
})

test('核心云函数超时配置保持一致', () => {
  const cloudbase = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
  const packageConfig = JSON.parse(fs.readFileSync(path.join(root, 'cloudfunctions/processKnowledge/package.json'), 'utf8'))
  const processConfig = cloudbase.functions.find(item => item.name === 'processKnowledge')
  assert.strictEqual(processConfig.timeout, 120)
  assert.strictEqual(packageConfig.timeout, processConfig.timeout)
  assert.ok(cloudConfig.timeouts.chatUpstream < clientConfig.timeouts.cloudFunction)
  assert.ok(clientConfig.timeouts.cloudFunction < processConfig.timeout * 1000)
})

test('小程序公共与私有构建配置保持安全一致', () => {
  const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
  const privateConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.private.config.json'), 'utf8'))
  assert.strictEqual(projectConfig.setting.urlCheck, true)
  assert.strictEqual(projectConfig.setting.uploadWithSourceMap, false)
  assert.strictEqual(projectConfig.libVersion, privateConfig.libVersion)
})

test('关键安全修复已接入路由', () => {
  const auth = fs.readFileSync(path.join(root, 'web-admin/server/routes/auth.js'), 'utf8')
  const processIndex = fs.readFileSync(path.join(root, 'cloudfunctions/processKnowledge/index.js'), 'utf8')
  const conversation = fs.readFileSync(path.join(root, 'cloudfunctions/chatConversation/index.js'), 'utf8')
  const adminConversations = fs.readFileSync(path.join(root, 'web-admin/server/routes/conversations.js'), 'utf8')
  const authMiddleware = fs.readFileSync(path.join(root, 'web-admin/server/middleware/auth.js'), 'utf8')
  assert.ok(!auth.includes('admin' + '123'))
  assert.ok(auth.includes("router.post('/register', authMiddleware, requireAdmin"))
  assert.ok(processIndex.includes("'chat.attachment.extract'"))
  assert.ok(processIndex.includes("'chat.streamToken'"))
  assert.ok(fs.readFileSync(path.join(root, 'cloudfunctions/processKnowledge/handlers/chat.js'), 'utf8').includes('isOwnedByAny'))
  assert.ok(conversation.includes('CHAT_CONVERSATION_ADMIN_SECRET'))
  assert.ok(authMiddleware.includes('function requireStaff'))
  assert.ok(adminConversations.includes('router.use(authMiddleware, requireStaff)'))
  assert.ok(adminConversations.includes("router.post('/sync-status', requireAdmin"))
  assert.ok(adminConversations.includes('const groupKey = hasSessionId'))
  assert.ok(adminConversations.includes('if (recordId) where._id = recordId'))
  const streamRoute = fs.readFileSync(path.join(root, 'web-admin/server/routes/chatStream.js'), 'utf8')
  assert.ok(streamRoute.includes("res.on('close'"))
  assert.ok(!streamRoute.includes("req.on('close'"))
  assert.ok(streamRoute.includes('上游流式响应未正常完成'))
})

console.log('\n全部核心测试通过。')
