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
const { parsePlannerJson, validateReadOnlyCypher, validateCypherAgainstSchema, buildConstrainedCypher } = require('../cloudfunctions/processKnowledge/lib/cypherSafety')
const { normalizeGraphRecords, documentEvidences, buildContext } = require('../cloudfunctions/processKnowledge/lib/hybridEvidence')
const { normalizeNeo4jParams } = require('../cloudfunctions/processKnowledge/lib/neo4jParams')
const { buildEvidenceGraph } = require('../utils/evidenceGraph')
const { isRetryablePlannerRequestError, plannerThinkingConfig } = require('../cloudfunctions/processKnowledge/lib/plannerFallback')
const { transactionTimeouts, isNeo4jTimeout } = require('../cloudfunctions/processKnowledge/lib/neo4jTimeout')
const { ENTITY_TYPE_NAMES, RELATION_TYPE_NAMES, validateDomainPlan } = require('../cloudfunctions/processKnowledge/lib/domainGraphSchema')
const { calculateHybridTimeout } = require('../utils/hybridTimeout')
const { expandBilingualQuery } = require('../cloudfunctions/processKnowledge/lib/bilingualQuery')

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

test('中英混合查询会展开双语领域术语且保持原问题', () => {
  const zh = expandBilingualQuery('含砷废水如何去除？')
  assert.strictEqual(zh.queries[0], '含砷废水如何去除？')
  assert.ok(zh.expanded.includes('arsenic'))
  assert.ok(zh.expanded.includes('wastewater'))
  assert.ok(zh.expanded.includes('removal'))
  const en = expandBilingualQuery('arsenic recovery from flue dust')
  assert.ok(en.expanded.includes('砷'))
  assert.ok(en.expanded.includes('烟尘'))
  assert.deepStrictEqual(en.detectedLanguages, ['en'])
  assert.ok(!expandBilingualQuery('wastewater treatment').terms.includes('砷'))
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

test('Cypher 规划 JSON 支持代码围栏并限制实体数量', () => {
  const plan = parsePlannerJson('```json\n{"entities":["砷","铜"],"entityTypes":[{"name":"砷","type":"化学元素/化合物"},{"name":"铜","type":"化学元素/化合物"}],"relations":["产生"],"intent":"查询关系","cypher":"MATCH p=(a)-[r]->(b) WHERE a.name = $entity RETURN nodes(p) AS nodes, relationships(p) AS relationships LIMIT $limit","params":{"entity":"砷","limit":12}}\n```')
  assert.deepStrictEqual(plan.entities, ['砷', '铜'])
  assert.strictEqual(plan.entityTypes[0].type, '化学元素/化合物')
  assert.strictEqual(plan.params.entity, '砷')
})

test('领域实体关系严格使用 schema.py 的 12 类实体和 24 类关系', () => {
  assert.deepStrictEqual(ENTITY_TYPE_NAMES, [
    '物料物质', '工艺过程', '设备设施', '参数指标', '产物废料', '组织机构',
    '环境要素', '化学元素/化合物', '添加剂', '检测方法', '工艺阶段', '标准规范'
  ])
  assert.deepStrictEqual(RELATION_TYPE_NAMES, [
    '含有', '产生', '消耗', '采用工艺', '发生于', '参数为', '转化为', '脱除/去除',
    '回收', '富集于', '挥发进入', '共沉淀', '污染/危害', '属于/是一种', '处理/治理',
    '制造/实施方', '分解', '吸附', '检测', '达到', '排放', '溶解', '沉淀', '氧化/还原'
  ])
  const plan = {
    entities: ['砷', '含砷废水'],
    entityTypes: [
      { name: '砷', type: '化学元素/化合物' },
      { name: '含砷废水', type: '环境要素' }
    ],
    relations: ['处理/治理'],
    params: { types: ['化学元素/化合物', '环境要素'], rel_types: ['处理/治理'] }
  }
  assert.strictEqual(validateDomainPlan(plan), true)
  assert.throws(() => validateDomainPlan({ ...plan, relations: ['治理'] }), /Schema 外/)
  assert.throws(() => validateDomainPlan({ ...plan, entityTypes: [{ name: '砷', type: '污染物' }] }), /Schema 外/)
})

test('只读 Cypher 校验接受参数化路径并收紧 LIMIT', () => {
  const result = validateReadOnlyCypher(
    'MATCH p=(a)-[r]->(b) WHERE a.name = $entity RETURN nodes(p) AS nodes, relationships(p) AS relationships LIMIT $limit',
    { entity: '砷', limit: 99 },
    { maxHops: 2, maxFacts: 12 }
  )
  assert.strictEqual(result.params.limit, 12)
})

test('只读 Cypher 校验拒绝写入、过程、多语句、字面量和无界路径', () => {
  const suffix = 'RETURN nodes(p) AS nodes, relationships(p) AS relationships LIMIT $limit'
  const params = { entity: '砷', limit: 10 }
  assert.throws(() => validateReadOnlyCypher(`MATCH p=(a)-[r]->(b) SET a.name = $entity ${suffix}`, params), /SET/)
  assert.throws(() => validateReadOnlyCypher(`MATCH p=(a)-[r]->(b) CALL db.labels() ${suffix}`, params), /CALL/)
  assert.throws(() => validateReadOnlyCypher(`MATCH p=(a)-[r]->(b); ${suffix}`, params), /单条/)
  assert.throws(() => validateReadOnlyCypher(`MATCH p=(a)-[r]->(b) WHERE a.name = '砷' ${suffix}`, { limit: 10 }), /字符串字面量/)
  assert.throws(() => validateReadOnlyCypher(`MATCH p=(a)-[r*]-(b) WHERE a.name = $entity ${suffix}`, params), /最小和最大/)
  assert.throws(() => validateReadOnlyCypher('MATCH p=(a)-[r]->(b) RETURN p LIMIT $limit', { limit: 10 }), /约定返回/)
  assert.throws(() => validateReadOnlyCypher(`MATCH p=(a)-[r]->(b) WHERE a.name = $entity ${suffix.replace('RETURN', 'ORDER BY a.name RETURN')}`, params), /ORDER/)
  assert.throws(() => validateReadOnlyCypher(`MATCH p=(a)-[r]->(b) ${suffix}`, { limit: 10 }), /WHERE/)
})

test('模型 Cypher 含字面量时可从实体关系生成参数化模板', () => {
  const plan = {
    entities: ['砷'],
    entityTypes: [{ name: '砷', type: '化学元素/化合物' }],
    relations: ['富集于'],
    entityAliases: { '砷': ['arsenic', 'As'] }
  }
  const schema = {
    nodes: [{ label: 'Entity', properties: ['name', 'type'] }],
    relationships: [{ type: 'RELATED_TO', properties: ['type'] }]
  }
  const fallback = buildConstrainedCypher(plan, schema, { maxFacts: 20 })
  assert.ok(!/['"]/.test(fallback.cypher))
  assert.ok(fallback.cypher.includes('ANY(term IN $entity_terms0'))
  assert.ok(fallback.cypher.includes('toLower(toString(a.name)) CONTAINS toLower(term)'))
  assert.deepStrictEqual(fallback.params.entity_terms0, ['砷', 'arsenic', 'As'])
  assert.ok(fallback.params.rel_types.includes('富集于'))
  assert.ok(fallback.params.rel_types.includes('enriched in'))
  assert.ok(fallback.params.entity_types.includes('化学元素/化合物'))
  assert.ok(fallback.params.entity_types.includes('chemical element/compound'))
  assert.strictEqual(validateReadOnlyCypher(fallback.cypher, fallback.params, { maxFacts: 20 }).params.limit, 20)
  assert.strictEqual(validateCypherAgainstSchema(fallback.cypher, schema), true)
})

test('Cypher 只能使用实时 schema 中存在的标签、关系和属性', () => {
  const schema = {
    nodes: [{ label: '工艺', properties: ['name', 'description'] }, { label: '污染物', properties: ['name'] }],
    relationships: [{ type: '产生', properties: ['source'] }]
  }
  assert.strictEqual(validateCypherAgainstSchema(
    'MATCH p=(a:工艺)-[:产生]->(b:污染物) WHERE a.name = $entity RETURN nodes(p) AS nodes, relationships(p) AS relationships LIMIT $limit',
    schema
  ), true)
  assert.throws(() => validateCypherAgainstSchema(
    'MATCH p=(a:不存在)-[:产生]->(b:污染物) RETURN nodes(p) AS nodes, relationships(p) AS relationships LIMIT $limit',
    schema
  ), /schema 外的节点标签/)
  assert.throws(() => validateCypherAgainstSchema(
    'MATCH p=(a:工艺)-[:未知关系]->(b:污染物) RETURN nodes(p) AS nodes, relationships(p) AS relationships LIMIT $limit',
    schema
  ), /schema 外的关系类型/)
})

test('混合证据过滤文档、去重图谱关系并使用独立引用编号', () => {
  const cfg = {
    context: { minScore: 40, maxChunks: 2, maxTokens: 100 },
    graph: { contextMaxTokens: 100 }
  }
  const documents = documentEvidences({ results: [
    { id: 'd1', title: '文档甲', content: '砷处理说明', score: 90, documentId: 'doc1' },
    { id: 'd2', title: '文档乙', content: '低相关内容', score: 20, documentId: 'doc2' }
  ] }, cfg)
  assert.strictEqual(documents.length, 1)
  assert.strictEqual(documents[0].score, 0.9)

  const record = {
    get(key) {
      if (key === 'nodes') return [
        { elementId: '1', properties: { name: '铜冶炼', description: '生产过程' } },
        { elementId: '2', properties: { name: '砷烟尘' } }
      ]
      if (key === 'relationships') return [{ type: '产生', startNodeElementId: '1' }]
      return null
    }
  }
  const graph = normalizeGraphRecords([record, record], 10)
  assert.strictEqual(graph.length, 1)
  assert.strictEqual(graph[0].title, '铜冶炼 —产生→ 砷烟尘')
  const context = buildContext(documents, graph, cfg)
  assert.ok(context.includes('[文档1]'))
  assert.ok(context.includes('[图谱1]'))
  assert.ok(!context.includes('[来源1]'))
})

test('图谱实体关系最多展示前 20 条', () => {
  const records = Array.from({ length: 25 }, (_, index) => ({
    get(key) {
      if (key === 'nodes') return [
        { elementId: `s${index}`, properties: { name: `实体${index}` } },
        { elementId: `t${index}`, properties: { name: `目标${index}` } }
      ]
      if (key === 'relationships') return [{ type: '含有', startNodeElementId: `s${index}` }]
      return null
    }
  }))
  const graph = normalizeGraphRecords(records, 20)
  assert.strictEqual(graph.length, 20)
  assert.strictEqual(graph[0].nodes[0], '实体0')
  assert.strictEqual(graph[19].nodes[1], '目标19')
})

test('图谱检索证据会聚合为节点—关系可视化数据', () => {
  const graph = buildEvidenceGraph([
    { id: 'g1', sourceType: 'neo4j', nodes: ['铜精矿', '砷'], relation: '含有' },
    { id: 'g2', sourceType: 'neo4j', nodes: ['砷', '烟尘'], relation: '富集于' },
    { id: 'd1', sourceType: 'zhipu', nodes: ['忽略', '忽略'], relation: '相关' }
  ])
  assert.strictEqual(graph.nodeCount, 3)
  assert.strictEqual(graph.edgeCount, 2)
  assert.strictEqual(graph.nodes.find(node => node.label === '砷').isCore, true)
  assert.ok(graph.edges.every(edge => edge.width > 0 && Number.isFinite(edge.angle)))
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
  assert.ok(processIndex.includes("'kb.hybrid.search'"))
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

test('混合检索严格先执行智谱检索再进入 Neo4j 规划', () => {
  const handler = fs.readFileSync(path.join(root, 'cloudfunctions/processKnowledge/handlers/hybridRag.js'), 'utf8')
  const zhipuPosition = handler.indexOf('zhipuKb.handleZhipuKBSearch')
  const graphPosition = handler.indexOf('loadNeo4jSchema(graphOptions')
  assert.ok(zhipuPosition > 0)
  assert.ok(graphPosition > zhipuPosition)
  assert.ok(handler.includes("['glm-5.3-flash', 'glm-4.7-flashx', 'glm-4.7-flash', 'glm-5.3']"))
  assert.strictEqual(clientConfig.zhipu.model, 'glm-5.3')
  assert.ok(handler.includes('[400, 429].includes(result.statusCode)'))
  assert.ok(handler.includes("{ role: 'user', content: String(query) }"))
  assert.ok(handler.includes('thinkingConfig: plannerThinkingConfig(model)'))
})

test('Cypher 规划模型请求超时会回退，鉴权错误不会回退', () => {
  assert.strictEqual(isRetryablePlannerRequestError(new Error('请求超时')), true)
  assert.strictEqual(isRetryablePlannerRequestError({ code: 'ECONNRESET', message: 'socket hang up' }), true)
  assert.strictEqual(isRetryablePlannerRequestError({ statusCode: 401, message: 'unauthorized' }), false)
})

test('GLM-5.3 规划使用 low 思考，其他 Flash 规划关闭思考', () => {
  assert.deepStrictEqual(plannerThinkingConfig('glm-5.3-flash'), { reasoning_effort: 'low' })
  assert.deepStrictEqual(plannerThinkingConfig('glm-5.3'), { reasoning_effort: 'low' })
  assert.deepStrictEqual(plannerThinkingConfig('glm-4.7-flash'), { type: 'disabled' })
  assert.deepStrictEqual(cloudConfig.zhipu.thinking, { reasoning_effort: 'low' })
})

test('智谱客户端使用标准 thinking.type 并兼容旧关闭参数', () => {
  const client = fs.readFileSync(path.join(root, 'cloudfunctions/processKnowledge/lib/zhipuClient.js'), 'utf8')
  assert.ok(client.includes("requestBody.thinking = { type: thinkingConfig.type }"))
  assert.ok(client.includes("requestBody.thinking = { type: 'disabled' }"))
  assert.ok(!client.includes('requestBody.enable_' + 'thinking = false'))
})

test('流式服务和客户端透传模型思考内容', () => {
  const client = fs.readFileSync(path.join(root, 'api/zhipu.js'), 'utf8')
  const streamRoute = fs.readFileSync(path.join(root, 'web-admin/server/routes/chatStream.js'), 'utf8')
  const indexPage = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8')
  assert.ok(client.includes('onReasoning'))
  assert.ok(client.includes('fullReasoning'))
  assert.ok(streamRoute.includes('delta.reasoning_content'))
  assert.ok(streamRoute.includes("JSON.stringify({ reasoning })"))
  assert.ok(indexPage.includes('toggleReasoningExpand'))
  assert.ok(indexPage.includes('reasoningExpanded`] = false'))
  assert.ok(indexPage.includes('const SHOW_REASONING = false'))
})

test('Neo4j 查询参数将 JSON 安全整数转换为驱动 Integer', () => {
  const converted = normalizeNeo4jParams({
    limit: 20,
    score: 0.75,
    values: [1, 2.5, { hops: 2 }],
    keyword: '含砷废液'
  }, value => ({ neo4jInteger: value }))

  assert.deepStrictEqual(converted.limit, { neo4jInteger: 20 })
  assert.strictEqual(converted.score, 0.75)
  assert.deepStrictEqual(converted.values, [
    { neo4jInteger: 1 },
    2.5,
    { hops: { neo4jInteger: 2 } }
  ])
  assert.strictEqual(converted.keyword, '含砷废液')
})

test('混合检索客户端超时覆盖完整顺序链路预算', () => {
  const config = {
    zhipu: { cloudTimeout: 15000 },
    retrieval: { rerankStatus: 0 },
    graph: { hybridTimeout: 35000, plannerTimeout: 12000, queryTimeout: 5000 }
  }
  assert.strictEqual(calculateHybridTimeout(config), 70000)
  config.retrieval.rerankStatus = 1
  assert.strictEqual(calculateHybridTimeout(config), 70000)
  config.graph.hybridTimeout = 110000
  assert.strictEqual(calculateHybridTimeout(config), 70000)
})

test('Neo4j 短事务超时会使用新事务按 15 秒重试', () => {
  assert.deepStrictEqual(transactionTimeouts(5000), [5000, 15000])
  assert.deepStrictEqual(transactionTimeouts(15000), [15000])
  assert.strictEqual(isNeo4jTimeout(new Error('The transaction has not completed within the timeout specified by the client.')), true)
  assert.strictEqual(isNeo4jTimeout(new Error('Neo4j authentication failed')), false)
})

console.log('\n全部核心测试通过。')
