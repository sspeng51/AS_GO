// Local integration harness: in-memory database and explicit fake upstreams, no network or real credentials.
const path = require('path')
const root = path.resolve(__dirname, '../..')
const serverRoot = path.join(root, 'web-admin/server')
const requireServer = name => require(require.resolve(name, { paths: [serverRoot] }))
function createHarness() {
  process.env.JWT_SECRET = 'test-rag-local-7f8b1de29ac34e80a596b3e1'
  process.env.ZHIPU_API_KEY = 'local-fixture-only'
  process.env.RAG_TUNING_SHARED_SECRET = 'local-rag-signing-fixture-74361b5043e148de'
  const tables = new Map()
  const state = { cloudCalls: [], cloudOptions: [], requiredCloudDurationMs: 0, modelCalls: [], modelError: false, lastEvidence: null }
  const db = {
    command: { set(value) { return { __replaceField: true, value } } },
    async createCollection(name) { state.collectionCreates ||= {}; state.collectionCreates[name] = (state.collectionCreates[name] || 0) + 1; if (!tables.has(name)) tables.set(name, new Map()) },
    collection(name) {
      const table = () => { if (!tables.has(name)) throw new Error('DATABASE_COLLECTION_NOT_EXIST'); return tables.get(name) }
      return {
        async count() { return { total: table().size } },
        orderBy() { return { limit(n) { return { async get() { return { data: [...table()].map(([id, data]) => ({ ...structuredClone(data), _id: id })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, n) } } } } } },
        doc(id) { return {
          async get() { const data = table().get(id); if (!data) throw new Error('DATABASE_DOCUMENT_NOT_EXIST'); return { data: { ...structuredClone(data), _id: id } } },
          async set(data) { table().set(id, structuredClone(data)) },
          async update(data) {
            const old = table().get(id)
            if (!old) throw new Error('DATABASE_DOCUMENT_NOT_EXIST')
            const fields = {}
            for (const [key, value] of Object.entries(data)) {
              if (value?.__replaceField) fields[key] = structuredClone(value.value)
              else {
                if (value && typeof value === 'object' && !Array.isArray(value) && old[key] === null) throw new Error(`Cannot create field in element {${key}: null}`)
                fields[key] = structuredClone(value)
              }
            }
            table().set(id, { ...old, ...fields })
          },
          async remove() { table().delete(id) }
        } }
      }
    }
  }
  const app = {
    async callFunction(request, options) {
      state.cloudCalls.push(request)
      state.cloudOptions.push(options)
      // Model the SDK's 15-second default without delaying the test wall clock.
      if ((options?.timeout || 15000) < state.requiredCloudDurationMs) {
        throw Object.assign(new Error('request timeout'), { code: 'ESOCKETTIMEDOUT' })
      }
      const payload = request.data.action === 'rag.tuning.search'
        ? require('../../cloudfunctions/processKnowledge/lib/tuningAuth').verifyTuningRequest(request.data.data, process.env.RAG_TUNING_SHARED_SECRET)
        : request.data.data
      if (payload.retrievalMode === 'graph' && state.graphTimeouts > 0) {
        state.graphTimeouts--
        throw Object.assign(new Error('graph timeout'), { code: 'ESOCKETTIMEDOUT' })
      }
      const query = payload.query
      if (query === '失败') return { result: { success: false, error: '测试上游超时' } }
      const evidences = query === '无答案' ? [] : [
        { sourceType: 'zhipu', chunkId: 'fixture-a', title: '测试资料：含砷废水处理', content: '【本地测试资料】含砷废水处理需要评估砷形态、pH 和共存离子，并通过实验验证去除效果。', score: 0.86 },
        { sourceType: 'neo4j', title: '砷 —关联→ 水处理', content: '【本地测试关系】砷与水处理的关联用于演示来源追溯。' }
      ]
      state.lastEvidence = evidences
      const retrievalMode = payload.retrievalMode || 'knowledge'
      if (query==='补检索') evidences[0].content+='补充证据：实验工况需要验证。'
      const selected = evidences.filter(item => retrievalMode === 'hybrid' || (retrievalMode === 'graph' ? item.sourceType === 'neo4j' : item.sourceType === 'zhipu'))
      return { result: { success: true, retrievalMode, evidences: selected, context: selected.map(item => item.content).join('\n'), retrievalCandidates: retrievalMode === 'graph' ? [] : evidences.slice(0, 1),
        knowledgeBase: { id: payload.knowledgeId || 'fixture-default', overridden: Boolean(payload.knowledgeId) },
        effectiveConfig: { zhipu: { topN: 15 }, context: { maxTokens: 2000 }, graph: { enabled: true } },
        sourceInfo: { degraded: query === '降级', zhipu: { success: true }, neo4j: { success: !['降级', '图谱失败'].includes(query) } } } }
    }
  }
  const cloudPath = path.join(serverRoot, 'utils/cloudbase.js')
  require.cache[require.resolve(cloudPath)] = { id: cloudPath, filename: cloudPath, loaded: true, exports: { getApp: () => app, getDB: () => db } }
  const axiosPath = require.resolve('axios', { paths: [serverRoot] })
  require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: {
    async get(url) {
      const id = decodeURIComponent(url.split('/').pop())
      return { data: { code: 200, data: { id, name: `测试知识库 ${id}` } } }
    },
    async post(url, payload, options) {
      state.modelCalls.push(payload)
      if (state.generationResetOnce && !payload.messages[0].content.includes('评审') && !payload.messages[0].content.includes('标准制定员')) {
        state.generationResetOnce = false
        throw Object.assign(new Error('fixture connection reset'), { code: 'ECONNRESET' })
      }
      state.modelOptions ||= []; state.modelOptions.push(options)
      if (state.judgeTimeoutOnce && payload.messages[0].content.includes('你是盲评回答质量')) {
        state.judgeTimeoutOnce = false
        throw Object.assign(new Error('fixture timeout'), { code: 'ECONNABORTED' })
      }
      if (/^glm-5\.3(?:-|$)/.test(payload.model) && payload.thinking?.type === 'disabled') {
        throw Object.assign(new Error('invalid thinking mode'), { response: { status: 400, data: { error: { code: '1210', message: '该模型始终思考，不支持关闭思考；请使用 low、high 或 max。' } } } })
      }
      if (payload.model === 'glm-5.3' && state.modelDelayMs) {
        state.activeModels = (state.activeModels || 0) + 1
        state.peakModels = Math.max(state.peakModels || 0, state.activeModels)
        await new Promise(resolve => setTimeout(resolve, state.modelDelayMs))
        state.activeModels--
      }
      if (state.modelError) throw new Error('fixture upstream failure')
      let content = '【本地模拟回答】应依据检索资料检查砷形态、pH 和共存离子；缺少实验数据时不能推断处理效率。'
      if (payload.messages[0].content.includes('你是科学问答测试标准制定员')) content = JSON.stringify({ points: [{ text: '评估砷形态', acceptance:'指出需评估砷形态', sourceIds: ['D1'] }], conditions: ['不推断效率'] })
      if (payload.messages[0].content.includes('补检索语句') || payload.messages[0].content.includes('生成1至2条知识库检索语句')) content=JSON.stringify({queries:['补检索']})
      if (state.factualRubricEmptyOnce && payload.messages[0].content.includes('你是科学问答测试标准制定员')) {state.factualRubricEmptyOnce=false;content=JSON.stringify({points:[],conditions:[],insufficientReason:'缺少实验条件'})}
      if (payload.messages[0].content.includes('你是科学问答盲评员')) {
        const input = JSON.parse(payload.messages[1].content)
        const reviews = input.answers.map(a => ({ id: a.id, result: { claims: [{ statement: '评估砷形态', quoteId: a.excerpts[0].id, verdict: 'correct', sourceIds: ['D1'], reason: 'D1明确要求评估形态' }], coverage: [{ point: 0, covered: true, decision:'complete',missing:[],quoteId: a.excerpts[0].id, reason: '覆盖形态要求' }], conditions: [{ point: 0, met: true, reason: '说明不能推断效率' }], extractionComplete: true } }))
        if (state.factualMissingOnce) { reviews.pop(); state.factualMissingOnce = false }
        content = JSON.stringify({ reviews })
      }
      if (payload.messages[0].content.includes('将用户问题拆解')) content = JSON.stringify(['处理方法', '适用条件'])
      if (payload.messages[0].content.includes('你是回答对比标准制定员')) content = JSON.stringify({ points: ['处理方法'], conditions: ['明确适用条件'] })
      if (state.rubricInvalidOnce && payload.messages[0].content.includes('你是回答对比标准制定员')) {
        state.rubricInvalidOnce = false; content = '{"points":['
      }
      if (payload.messages[0].content.includes('你是盲评回答质量')) {
        const input = JSON.parse(payload.messages[1].content)
        const fine=payload.messages[0].content.includes('analytic-100-v2')
        const extra=key=>fine?{breakdown:key==='claims'?{core:60,depth:25,boundary:15}:{core:40,depth:35,boundary:25},supportScore:100,citationScore:null}:{}
        const makeVerdict = answer => ({ claims: [{ ...extra('claims'), statement: '模拟技术结论', quote: answer.slice(0, 15), score: 4, correct: true, supported: true, citedIds: [], citationSupported: null, reason: '模拟评审' }], conditions: input.rubric.conditions.map((v, i) => ({ ...extra('conditions'), point: i, score: 4, applicable: true, quote: answer.slice(0, 15), reason: '模拟工况评分' })), coverage: input.rubric.points.map((v, i) => ({ ...extra('coverage'), point: i, score: 4, covered: true, quote: answer.slice(0, 15), reason: '模拟覆盖评分' })) })
        const reviews = input.answers?.map(item => ({ id: item.id, result: makeVerdict(item.answer || item.answerExcerpts.map(part => part.quote).join('\n')) }))
        if (state.invalidBatchOnce && reviews) { reviews[0].result.claims[0].quote = '不在回答中的虚构原文'; state.invalidBatchOnce = false }
        content = JSON.stringify(reviews ? { reviews } : makeVerdict(input.answer))
        if (state.invalidBatchJSON) content = 'invalid json'

      }
      if (payload.messages[0].content.includes('你是检索评估员')) {
        const input = JSON.parse(payload.messages[1].content)
        content = JSON.stringify({ grades: input.results.map(item => ({ id: item.id, grade: 2, ...(input.requireBreakdown?{breakdown:{directness:45,scope:25,detail:15}}:input.requireFine?{relevanceScore:85}:{}), reason: '本地模拟初评，仅用于接口验证', quote: item.content.slice(0, 10) })), coverage: input.evidencePoints.length ? [{ point: 0, ids: [input.results[0].id] }] : [], sufficiency: '本地模拟初评：尚需人工核验资料充分性。' })
        if (state.invalidJudgeOnce) { content = '{"grades":[]}'; state.invalidJudgeOnce = false }
      }
      const usage = { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 }
      if (payload.stream) return { data: require('stream').Readable.from([Buffer.from(`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}],usage})}\n\ndata: [DONE]\n\n`)]) }
      return { data: { choices: [{ message: { content }, finish_reason: 'stop' }], usage } }
    }
  } }
  delete require.cache[require.resolve(path.join(serverRoot, 'middleware/auth.js'))]
  delete require.cache[require.resolve(path.join(serverRoot, 'utils/knowledgeName.js'))]
  delete require.cache[require.resolve(path.join(serverRoot, 'routes/ragTuning.js'))]
  const auth = require(path.join(serverRoot, 'middleware/auth.js'))
  const express = requireServer('express')
  const http = express()
  http.use(express.json())
  http.use('/api/rag-tuning', require(path.join(serverRoot, 'routes/ragTuning.js')))
  const token = role => auth.generateToken({ username: `fixture-${role}`, role })
  return { http, token, state, tables, db, root }
}
module.exports = { createHarness }
