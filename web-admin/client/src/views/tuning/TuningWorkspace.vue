<script setup>
import { DEFAULT_KNOWLEDGE_ID } from './defaultKnowledge.mjs'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import RunReview from './RunReview.vue'
import JudgeQueue from './JudgeQueue.vue'
const props = defineProps({ mode: { type: String, default: 'retrieval' } })
const auth = useAuthStore()
const page = ref(`${props.mode}-test`)
const query = ref('')
const k = ref(5)
const knowledgeId = ref(DEFAULT_KNOWLEDGE_ID)
const retrievalMode = ref('knowledge')
const rerankLabels = { enabled: '已重排', disabled: '主动关闭', fallback_off: '回退未重排', fallback_mixed: '部分重排回退', not_applicable: '不适用', unknown: '未记录' }
const modeLabels = { knowledge: '仅知识库', graph: '仅知识图谱', hybrid: '混合检索' }
const knowledgeOverrideReady = ref(false)
const batchUseCurrentKnowledgeId = ref(false)
const testMode = ref('retrieve')
const busy = ref('')
const loading = ref(false)
const loadError = ref('')
const run = ref(null)
const cases = ref([])
const history = ref([])
const summary = ref(null)
const knowledgeSummaries = ref([])
const selected = ref([])
const caseId = ref(null)
const messages = ref([])
const chatRunIds = ref([])
const models = ref([])
const generation = ref({ model: '', temperature: 0.3, maxTokens: 2048, systemPrompt: '' })
const batch = ref(null)
const stopBatch = ref(false)
const batchRuns = ref([])
const dialog = ref(false)
const editing = ref({})
const referencesText = ref('[]')
const pointsText = ref('')
const importInput = ref(null)
const comparison = ref(null)
const isChat = computed(() => props.mode === 'generation' || testMode.value === 'chat')
const disabled = computed(() => !auth.isAdmin || !!busy.value || loading.value)
const knownKnowledgeIds = computed(() => [...new Set([...cases.value.map(item => item.knowledgeId), ...history.value.map(item => item.knowledgeBase?.id), knowledgeId.value].filter(Boolean))])
function suggestKnowledgeIds(text, callback) {
  callback(knownKnowledgeIds.value.filter(id => id.toLowerCase().includes(text.toLowerCase())).map(value => ({ value })))
}
const metricNames = { precisionAtK: 'Precision@K', recallAtK: 'Recall@K', mrr: 'MRR@K', ndcgAtK: 'nDCG@K', evidenceCoverage: '证据覆盖率', noAnswerCorrect: '无答案判断准确率', falseRecall: '无答案误召回率', empty: '空结果比例' }
const format = value => typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '待评估'
const fail = error => ElMessage.error(error.response?.data?.error || error.message)
onMounted(load)
onBeforeUnmount(() => { stopBatch.value = true })

async function load() {
  loading.value = true
  loadError.value = ''
  const results = await Promise.allSettled([api.get('/rag-tuning/settings'), api.get('/rag-tuning/cases'), api.get('/rag-tuning/runs')])
  results.forEach((result, index) => {
    if (result.status === 'rejected') { loadError.value += `${['生成配置', '测试集', '运行记录'][index]}加载失败；`; return }
    const data = result.value.data
    if (index === 0) { generation.value = data.generation; models.value = data.models; knowledgeOverrideReady.value = data.knowledgeOverrideReady }
    if (index === 1) cases.value = data.cases
    if (index === 2) { history.value = data.runs; summary.value = data.summary; knowledgeSummaries.value = data.byKnowledgeBase || [] }
  })
  loading.value = false
}
async function refreshRuns() {
  const { data } = await api.get('/rag-tuning/runs')
  history.value = data.runs
  summary.value = data.summary
  knowledgeSummaries.value = data.byKnowledgeBase || []
}
async function retrieve(question, id = null, batchId = '', targetKnowledgeId = knowledgeId.value) {
  const { data } = await api.post('/rag-tuning/retrieve', { query: question, k: k.value, retrievalMode: retrievalMode.value, caseId: id, batchId, knowledgeId: targetKnowledgeId.trim() }, { timeout: 120000 })
  return data.run
}
async function execute() {
  if (!query.value.trim()) return ElMessage.warning('请输入测试问题')
  busy.value = 'test'
  try {
    const current = cases.value.find(item => item._id === caseId.value)
    run.value = await retrieve(query.value.trim(), current?.query === query.value.trim() ? current._id : null)
    if (isChat.value && !run.value.error) await generateAnswer()
    await refreshRuns()
  } catch (error) { fail(error) }
  finally { busy.value = '' }
}
async function generateAnswer() {
  const { data } = await api.post('/rag-tuning/chat', {
    runId: run.value._id, query: run.value.query, generation: generation.value, messages: messages.value.slice(-12)
  }, { timeout: 120000 })
  run.value = { ...run.value, generation: data.generation }
  messages.value.push({ role: 'user', content: run.value.query }, { role: 'assistant', content: data.generation.answer })
  chatRunIds.value.push(run.value._id)
}
async function regenerate() {
  busy.value = 'generate'
  try {
    const { data } = await api.post('/rag-tuning/chat', { runId: run.value._id, query: run.value.query, generation: generation.value, messages: [] }, { timeout: 120000 })
    run.value = { ...run.value, generation: data.generation }
  } catch (error) { fail(error) }
  finally { busy.value = '' }
}
async function saveSettings() {
  busy.value = 'settings'
  try { await api.put('/rag-tuning/settings', { generation: generation.value }); ElMessage.success('生成实验默认值已保存') }
  catch (error) { fail(error) }
  finally { busy.value = '' }
}
function useCase(item) {
  retrievalMode.value = item.retrievalMode || 'hybrid'; query.value = item.query; knowledgeId.value = item.knowledgeId || ''; caseId.value = item._id; messages.value = []; chatRunIds.value = []; page.value = `${props.mode}-test`
}
function editCase(item = null) {
  editing.value = item ? { ...item, retrievalMode: item.retrievalMode || 'hybrid', id: item._id } : { retrievalMode: retrievalMode.value, query: query.value, knowledgeId: knowledgeId.value, category: '直接查询', corpusVersion: '', noAnswer: null, referencesComplete: false, references: [], evidencePoints: [] }
  referencesText.value = JSON.stringify(editing.value.references, null, 2)
  pointsText.value = editing.value.evidencePoints.join('\n')
  dialog.value = true
}
function goldFromReview({ run: value, grades }) {
  const existing = cases.value.find(item => item._id === value.caseId)
  editCase(existing || { ...value.testCase, _id: undefined, query: value.query })
  editing.value.retrievalMode = value.retrievalMode || 'hybrid'
  editing.value.knowledgeId = value.knowledgeBase?.id || value.requestedKnowledgeId || ''
  if (value.standardWarning) {
    editing.value.id = undefined
    editing.value.references = []
    editing.value.corpusVersion = ''
    editing.value.noAnswer = null
  }
  const refs = new Map((editing.value.references || []).map(item => [item.id, item.grade]))
  for (const [id, grade] of Object.entries(grades)) refs.set(id, grade)
  referencesText.value = JSON.stringify([...refs].map(([id, grade]) => ({ id, grade })), null, 2)
  // A pool of retrieved results does not prove that all relevant evidence was found.
  editing.value.referencesComplete = false
}
async function saveCase() {
  let references
  try { references = JSON.parse(referencesText.value) } catch { return ElMessage.error('标准资料必须是合法 JSON 数组') }
  busy.value = 'case'
  try {
    const { data } = await api.post('/rag-tuning/cases', { ...editing.value, references, evidencePoints: pointsText.value.split('\n').map(value => value.trim()).filter(Boolean) })
    cases.value = [data.testCase, ...cases.value.filter(item => item._id !== data.testCase._id)]
    dialog.value = false
    ElMessage.success('测试标准已保存；历史记录保留原标准，重新运行后采用新标准')
  } catch (error) { fail(error) }
  finally { busy.value = '' }
}
async function removeCase(item) {
  try { await ElMessageBox.confirm(`删除测试问题“${item.query}”？历史运行记录会保留。`, '删除测试问题', { type: 'warning' }) } catch { return }
  busy.value = 'delete'
  try { await api.delete(`/rag-tuning/cases/${item._id}`); cases.value = cases.value.filter(value => value._id !== item._id) }
  catch (error) { fail(error) }
  finally { busy.value = '' }
}
async function runBatch() {
  const items = [...selected.value]
  if (!items.length) return ElMessage.warning('请先选择测试问题')
  busy.value = 'batch'; stopBatch.value = false; batchRuns.value = []
  batch.value = { id: crypto.randomUUID(), done: 0, total: items.length, failed: 0 }
  for (const item of items) {
    if (stopBatch.value) break
    try {
      const value = await retrieve(item.query, item._id, batch.value.id, batchUseCurrentKnowledgeId.value ? knowledgeId.value : (item.knowledgeId || ''))
      batchRuns.value.push(value)
      if (!value.metrics?.eligible) batch.value.failed++
    } catch (error) {
      batch.value.failed++
      batchRuns.value.push({ query: item.query, error: error.response?.data?.error || error.message })
      if ([401, 403, 429].includes(error.response?.status)) stopBatch.value = true
    }
    batch.value.done++
  }
  busy.value = ''
  try { await refreshRuns() } catch (error) { fail(error) }
}
async function openRun(id, compare = false) {
  busy.value = 'open'
  try {
    const { data } = await api.get(`/rag-tuning/runs/${id}`)
    if (compare) comparison.value = data.run
    else { run.value = data.run; retrievalMode.value = data.run.retrievalMode || 'hybrid'; query.value = data.run.query; knowledgeId.value = data.run.knowledgeBase?.id || data.run.requestedKnowledgeId || ''; caseId.value = data.run.caseId; messages.value = []; chatRunIds.value = []; page.value = `${props.mode}-test` }
  } catch (error) { fail(error) }
  finally { busy.value = '' }
}
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name}.json`; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function importCases(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  if (file.size > 1024 * 1024) return ElMessage.error('测试集文件不能超过 1 MB')
  let values
  try {
    values = JSON.parse(await file.text())
    if (!Array.isArray(values) || values.length > 100) throw new Error('最多导入 100 条测试问题')
  } catch (error) { return fail(error) }
  busy.value = 'import'
  let count = 0
  try {
    for (const item of values) {
      const { id, _id, ...value } = item
      const { data } = await api.post('/rag-tuning/cases', value)
      cases.value.unshift(data.testCase); count++
    }
    ElMessage.success(`已导入 ${count} 条测试问题`)
  } catch (error) { ElMessage.error(`已导入 ${count} 条，后续停止：${error.response?.data?.error || error.message}`) }
  finally { busy.value = '' }
}
function updateRun(value) { run.value = value; refreshRuns().catch(fail) }
</script>

<template>
  <div class="workspace" v-loading="loading">
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false"><el-button text @click="load">重试加载</el-button></el-alert>
    <el-alert v-if="!auth.isAdmin" title="只读账号可查看参数、测试集和评估记录；运行测试、模型调用及标注需要管理员权限。" type="info" :closable="false" />
    <el-alert title="默认仅检索智谱知识库，不调用图谱规划或 Neo4j。测试模式仅影响本次运行；其余参数读取已生效配置（缓存最长 5 分钟）。" type="info" :closable="false" />
    <div class="toolbar"><b>检索范围</b><el-radio-group v-model="retrievalMode" :disabled="!!busy"><el-radio-button v-for="(label, value) in modeLabels" :key="value" :value="value">{{ label }}</el-radio-button></el-radio-group><span class="muted">单次、对话和批量测试均使用当前选择</span></div>
    <el-card v-if="retrievalMode !== 'graph'" shadow="never" class="target-card">
      <div class="toolbar"><b>目标智谱知识库 ID</b>
        <el-autocomplete v-model="knowledgeId" :fetch-suggestions="suggestKnowledgeIds" clearable :disabled="!!busy" maxlength="128" placeholder="输入知识库 ID 或选择历史记录；留空使用默认库" class="knowledge-select" />
        <el-tag effect="plain">{{ knowledgeId ? '指定知识库' : '默认知识库' }}</el-tag>
      </div>
      <p class="muted">可选择历史 ID 或输入新的 ID。本次指定仅影响测试，不修改小程序默认知识库。仅“混合检索”会同时查询图谱。</p>
      <el-alert v-if="knowledgeId && !knowledgeOverrideReady" title="后台尚未配置知识库切换签名密钥。请在后台与云函数配置相同的 RAG_TUNING_SHARED_SECRET，或复用 STREAM_SHARED_SECRET。" type="warning" :closable="false" />
    </el-card>
    <el-card v-if="mode === 'generation'" shadow="never" class="settings-card">
      <template #header><div class="toolbar"><b>生成实验参数</b><el-button :disabled="disabled" :loading="busy === 'settings'" @click="saveSettings">保存实验默认值</el-button></div></template>
      <p class="muted">用于本工作台的回答测试，可在相同检索上下文上反复比较。保存实验默认值不会发布为小程序生产配置。</p>
      <el-form label-position="top" :disabled="disabled">
        <div class="settings-grid">
          <el-form-item label="回答模型"><el-select v-model="generation.model"><el-option v-for="model in models" :key="model" :label="model" :value="model" /></el-select></el-form-item>
          <el-form-item label="Temperature"><el-input-number v-model="generation.temperature" :min="0" :max="1" :step="0.1" /></el-form-item>
          <el-form-item label="最大输出 Token"><el-input-number v-model="generation.maxTokens" :min="128" :max="4096" :step="128" /></el-form-item>
        </div>
        <el-form-item label="系统提示词"><el-input v-model="generation.systemPrompt" type="textarea" :rows="4" maxlength="8000" show-word-limit /></el-form-item>
      </el-form>
    </el-card>
    <el-tabs v-model="page">
      <el-tab-pane :label="mode === 'generation' ? '对话与回答测试' : '单次测试'" :name="`${mode}-test`">
        <el-card shadow="never">
          <div class="toolbar">
            <el-radio-group v-if="mode === 'retrieval'" v-model="testMode" :disabled="!!busy"><el-radio-button value="retrieve">仅检索</el-radio-button><el-radio-button value="chat">检索＋对话</el-radio-button></el-radio-group>
            <span class="muted">评估 K</span><el-input-number v-model="k" :min="1" :max="20" :disabled="!!busy" size="small" />
            <el-select v-model="caseId" placeholder="选择测试问题" clearable filterable :disabled="!!busy" class="case-select" @change="id => { const item = cases.find(value => value._id === id); if (item) useCase(item) }"><el-option v-for="item in cases" :key="item._id" :label="item.query" :value="item._id" /></el-select>
          </div>
          <el-input v-model="query" type="textarea" :rows="3" maxlength="1000" show-word-limit :disabled="!!busy" placeholder="输入真实用户问题。多轮测试时请写清本轮检索对象。" />
          <div class="toolbar">
            <el-button type="primary" :disabled="disabled || !query.trim()" :loading="busy === 'test'" @click="execute">{{ isChat ? '检索并发送' : '运行检索' }}</el-button>
            <el-button :disabled="disabled" @click="editCase()">存为测试问题</el-button>
            <el-button v-if="isChat" :disabled="!!busy" @click="messages = []; chatRunIds = []">清空对话历史</el-button>
            <span v-if="isChat" class="muted">每轮重新检索当前问题，生成时携带最近 12 条对话；追问请补全实体名称。</span>
          </div>
          <div v-if="messages.length" class="conversation">
            <div v-for="(message, index) in messages" :key="index" class="bubble" :class="message.role"><small>{{ message.role === 'user' ? '测试问题' : '模型回答' }}</small><pre>{{ message.content }}</pre></div>
            <el-button text @click="download('对话测试', { messages, runIds: chatRunIds })">导出对话</el-button>
          </div>
        </el-card>
        <el-card v-if="run" shadow="never" class="result-card">
          <template #header><div class="toolbar"><b>测试记录 · {{ run.query }}</b><el-button @click="download('RAG测试记录', run)">导出记录</el-button></div></template>
          <div v-if="mode === 'generation'" class="generation-result">
            <el-button type="primary" plain :disabled="disabled || !!run.error" :loading="busy === 'generate'" @click="regenerate">用当前参数重跑相同上下文（单轮）</el-button>
            <p class="muted">保留前后结果用于比较时，请先导出当前记录。此操作更新本记录最近一次生成结果。</p>
          </div>
          <div v-if="run.generation" class="generation-result">
            <h3>本次生成结果</h3><pre>{{ run.generation.answer }}</pre>
            <p class="muted">{{ run.generation.settings.model }} · {{ run.generation.latencyMs }} ms · Token：{{ run.generation.usage?.total_tokens ?? '上游未提供' }} · 完成原因：{{ run.generation.finishReason || '未知' }} · 金额：未配置计费数据</p>
            <el-alert v-if="run.generation.finishReason === 'length'" title="回答因长度限制截断，请增大输出预算后重试。" type="warning" :closable="false" />
          </div>
          <RunReview :key="run._id" :run="run" :locked="!!busy" @update="updateRun" @gold="goldFromReview" @busy="value => busy = value" />
        </el-card>
        <el-empty v-else description="输入一个真实问题，查看检索证据与评估结果" :image-size="85" />
      </el-tab-pane>
      <el-tab-pane label="测试集与批量评估" :name="`${mode}-cases`">
        <p class="muted">覆盖直接查询、同义表达、模糊描述、多条件、跨文档和无答案问题。维护知识库 ID、版本、标准资料与证据点；最多 100 条。批量运行仅做检索，不自动调用评审模型。</p>
        <el-switch v-model="batchUseCurrentKnowledgeId" :disabled="!!busy" active-text="整批使用上方目标知识库" inactive-text="按每个用例保存的知识库测试" />
        <div class="toolbar">
          <el-button type="primary" :disabled="disabled" @click="editCase()">新增问题</el-button>
          <el-button :disabled="disabled || !selected.length" :loading="busy === 'batch'" @click="runBatch">批量运行（{{ selected.length }}）</el-button>
          <el-button v-if="busy === 'batch'" @click="stopBatch = true">本题结束后停止</el-button>
          <el-button :disabled="disabled" @click="importInput.click()">导入 JSON</el-button>
          <el-button @click="download('RAG测试集', cases)">导出测试集</el-button>
          <el-button @click="download('RAG测试集模板', [{ query: '填写真实问题', retrievalMode: 'knowledge', knowledgeId: '', category: '直接查询', corpusVersion: '知识库版本或日期', noAnswer: null, referencesComplete: false, references: [], evidencePoints: ['回答必须覆盖的证据点'] }])">下载模板</el-button>
          <input ref="importInput" hidden type="file" accept=".json,application/json" @change="importCases">
        </div>
        <div v-if="batch" class="batch-status"><el-progress :percentage="Math.round(batch.done / batch.total * 100)" /><span>{{ batch.done }}/{{ batch.total }} · 失败或不完整 {{ batch.failed }} · {{ busy === 'batch' ? '运行中' : batch.done < batch.total ? '已停止' : '已完成' }}</span><el-button text :disabled="busy === 'batch'" @click="download('批量评估完整记录', { batch, runs: batchRuns })">导出本批完整结果</el-button></div>
        <el-table :data="cases" @selection-change="items => selected = items" empty-text="暂无测试问题，新增或导入真实问题开始评估">
          <el-table-column type="selection" width="45" :selectable="() => !busy" />
          <el-table-column prop="query" label="问题" min-width="220" />
          <el-table-column prop="category" label="类型" width="110" />
          <el-table-column label="知识库 ID" min-width="150"><template #default="{ row }">{{ row.knowledgeId || '默认知识库' }}</template></el-table-column>
          <el-table-column prop="corpusVersion" label="知识库版本" width="130" />
          <el-table-column label="标准" width="130"><template #default="{ row }">{{ row.references?.length || 0 }} 条 · {{ row.referencesComplete ? '完整' : '待完善' }}</template></el-table-column>
          <el-table-column label="操作" width="195"><template #default="{ row }"><el-button text :disabled="!!busy" @click="useCase(row)">测试</el-button><el-button text :disabled="disabled" @click="editCase(row)">编辑</el-button><el-button text type="danger" :disabled="disabled" @click="removeCase(row)">删除</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="批量初评与待抽查" :name="`${mode}-queue`">
        <JudgeQueue :active="page === `${mode}-queue`" :batch-id="batch?.id || ''" :locked="!!busy" @busy="value => busy = value" @open="openRun" />
      </el-tab-pane>
      <el-tab-pane label="评估记录" :name="`${mode}-history`">
        <div class="toolbar"><h3>最近 30 次检索</h3><el-button :disabled="!!busy" @click="refreshRuns().catch(fail)">刷新记录</el-button><el-button @click="download('最近评估摘要', { summary, byKnowledgeBase: knowledgeSummaries, runs: history })">导出摘要</el-button></div>
        <p class="muted">下方为最近运行的描述统计，各指标显示有效样本数。可能包含不同问题、K 和配置，不可直接作为 A/B 结论；对比应使用相同问题集、知识库版本、K 和上下文预算。</p>
        <div v-if="summary" class="summary-grid"><div><small>P95 检索耗时</small><b>{{ summary.p95LatencyMs ?? '—' }} ms</b></div><div><small>失败 / 不完整</small><b>{{ summary.failed }} / {{ summary.count }}</b></div><div v-for="(label, key) in metricNames" :key="key"><small>{{ label }} · n={{ summary[key]?.samples || 0 }}</small><b>{{ format(summary[key]?.value) }}</b></div></div>
        <h4>按知识库与检索模式分别统计</h4>
        <el-table :data="knowledgeSummaries" empty-text="暂无知识库评估数据">
          <el-table-column label="重排状态" width="140"><template #default="{ row }">{{ rerankLabels[row.rerankMode || 'unknown'] }}</template></el-table-column>
          <el-table-column label="检索模式" width="120"><template #default="{ row }">{{ modeLabels[row.retrievalMode || 'hybrid'] }}</template></el-table-column>
          <el-table-column label="知识库 ID" min-width="200"><template #default="{ row }">{{ row.retrievalMode === 'graph' ? '不适用（图谱）' : row.knowledgeId || '默认库（ID 未核验）' }}</template></el-table-column>
          <el-table-column prop="count" label="运行数" width="80" /><el-table-column prop="failed" label="失败/不完整" width="100" />
          <el-table-column label="Precision / 样本数" min-width="160"><template #default="{ row }">{{ format(row.precisionAtK.value) }} / {{ row.precisionAtK.samples }}</template></el-table-column>
          <el-table-column label="Recall / 样本数" min-width="160"><template #default="{ row }">{{ format(row.recallAtK.value) }} / {{ row.recallAtK.samples }}</template></el-table-column>
          <el-table-column label="P95" width="100"><template #default="{ row }">{{ row.p95LatencyMs }} ms</template></el-table-column>
        </el-table>
        <h4>逐次运行记录</h4>
        <el-table :data="history" empty-text="暂无评估记录">
          <el-table-column label="重排状态" width="140"><template #default="{ row }">{{ rerankLabels[row.metrics.rerankMode || 'unknown'] }}</template></el-table-column>
          <el-table-column label="检索模式" width="120"><template #default="{ row }">{{ modeLabels[row.retrievalMode || 'hybrid'] }}</template></el-table-column>
          <el-table-column prop="query" label="问题" min-width="220" />
          <el-table-column prop="k" label="K" width="50" />
          <el-table-column label="知识库 ID" min-width="150"><template #default="{ row }">{{ row.retrievalMode === 'graph' ? '不适用（图谱）' : row.knowledgeBase?.id || row.requestedKnowledgeId || '默认库（ID 未核验）' }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="!row.metrics.eligible ? 'warning' : 'success'">{{ row.error ? '失败' : !row.metrics.eligible ? '不计分' : '成功' }}</el-tag></template></el-table-column>
          <el-table-column label="Precision" width="105"><template #default="{ row }">{{ format(row.metrics.precisionAtK) }}</template></el-table-column>
          <el-table-column label="Recall" width="100"><template #default="{ row }">{{ format(row.metrics.recallAtK) }}</template></el-table-column>
          <el-table-column prop="createdAt" label="运行时间" min-width="190" />
          <el-table-column label="操作" width="175"><template #default="{ row }"><el-button text :disabled="!!busy" @click="openRun(row._id)">查看</el-button><el-button text :disabled="!run || !!busy" @click="openRun(row._id, true)">与当前对比</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialog" :title="editing.id ? '编辑测试标准' : '新增测试问题'" width="min(760px, 95vw)" :close-on-click-modal="false">
      <el-form label-position="top" :disabled="!!busy">
        <el-form-item label="真实问题"><el-input v-model="editing.query" type="textarea" :rows="2" maxlength="1000" /></el-form-item>
        <el-form-item label="标准对应的检索范围"><el-radio-group v-model="editing.retrievalMode"><el-radio v-for="(label, value) in modeLabels" :key="value" :value="value">{{ label }}</el-radio></el-radio-group></el-form-item>
        <el-form-item label="目标智谱知识库 ID（留空使用默认库）"><el-input v-model="editing.knowledgeId" maxlength="128" placeholder="填写该问题对应的知识库 ID" /></el-form-item>
        <div class="settings-grid"><el-form-item label="问题类型"><el-select v-model="editing.category"><el-option v-for="value in ['直接查询', '同义表达', '模糊描述', '多条件查询', '跨文档问题', '无答案问题']" :key="value" :value="value" :label="value" /></el-select></el-form-item><el-form-item label="知识库版本 / 日期"><el-input v-model="editing.corpusVersion" maxlength="100" /></el-form-item></div>
        <el-form-item label="知识库是否应有答案"><el-radio-group v-model="editing.noAnswer"><el-radio :value="null">未知</el-radio><el-radio :value="false">应有答案</el-radio><el-radio :value="true">确定无答案</el-radio></el-radio-group></el-form-item>
        <el-form-item label="必需证据点（每行一条）"><el-input v-model="pointsText" type="textarea" :rows="3" placeholder="例如：适用条件；处理步骤；效率依据" /></el-form-item>
        <el-form-item label='标准资料 JSON：[{"id":"结果中的资料 ID","grade":2}]'><el-input v-model="referencesText" type="textarea" :rows="5" /></el-form-item>
        <el-checkbox v-model="editing.referencesComplete">已核验完整相关资料集合，可计算 Recall / nDCG</el-checkbox>
        <p class="muted">0 无关、1 背景相关、2 直接支撑。未声明完整时，未列出的资料保持未知；不能仅凭一次检索结果认定标准完整。更新标准后须重跑用例，历史评估保留原快照。</p>
      </el-form>
      <template #footer><el-button :disabled="!!busy" @click="dialog = false">取消</el-button><el-button type="primary" :disabled="!auth.isAdmin || !!busy" :loading="busy === 'case'" @click="saveCase">保存测试标准</el-button></template>
    </el-dialog>
    <el-dialog :model-value="!!comparison" title="与当前测试记录对比" width="min(1000px, 95vw)" @close="comparison = null">
      <template v-if="comparison && run">
        <el-alert title="仅当问题、标准资料、知识库版本、K 和预算一致时，指标变化才可用于参数比较。" type="info" :closable="false" />
        <el-table :data="Object.entries(metricNames).map(([key, label]) => ({ label, current: format(run.metrics[key]), other: format(comparison.metrics[key]) }))"><el-table-column prop="label" label="指标" /><el-table-column prop="current" label="当前记录" /><el-table-column prop="other" label="对比记录" /></el-table>
        <div class="compare-grid"><div v-for="value in [run, comparison]" :key="value._id"><b>{{ value.query }} · {{ modeLabels[value.retrievalMode || 'hybrid'] }} · K={{ value.k }}</b><p>知识库：{{ value.knowledgeBase?.id || value.requestedKnowledgeId || '默认库（ID 未核验）' }}</p><p>{{ value.testCase.corpusVersion || '知识库版本未标注' }}</p><pre>{{ JSON.stringify(value.effectiveConfig, null, 2) }}</pre></div></div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.workspace { min-width: 0; }
.workspace > .el-alert { margin-bottom: 14px; }
.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
.toolbar b, .toolbar h3 { margin: 0; margin-right: auto; }
.toolbar .el-button + .el-button { margin-left: 0; }
.case-select { width: 280px; max-width: 100%; }
.knowledge-select { width: 420px; max-width: 100%; }
.target-card { margin-bottom: 16px; }
.settings-card, .result-card { margin: 18px 0; }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; }
.muted { color: #778498; font-size: 12px; line-height: 1.8; }
.conversation { padding: 16px 0; }
.bubble { border-radius: 10px; padding: 14px 18px; margin: 12px 0; background: #f1f5fa; }
.bubble.user { margin-left: 12%; background: #eaf2ff; }
.bubble.assistant { margin-right: 5%; }
.bubble small { color: #6c7e96; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; font: inherit; max-height: 450px; overflow: auto; }
.generation-result { border-bottom: 1px solid #e8edf3; padding-bottom: 16px; margin-bottom: 16px; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin: 16px 0; }
.summary-grid > div { background: white; border: 1px solid #e7edf5; padding: 14px; border-radius: 8px; }
.summary-grid small { display: block; color: #738097; margin-bottom: 10px; }
.summary-grid b { color: #294668; font-size: 19px; }
.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
.batch-status { background: #f2f6fc; padding: 15px; margin: 12px 0; border-radius: 8px; font-size: 13px; }
@media (max-width: 720px) { .compare-grid { grid-template-columns: 1fr; } }
</style>
