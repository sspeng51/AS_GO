<script setup>
import { DEFAULT_KNOWLEDGE_ID } from './defaultKnowledge.mjs'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import miniappPrompt from '../../../../shared/miniappAnswerPrompt.json'
import recommended from '../../../../shared/answerDefaults.json'
import { useAuthStore } from '@/stores/auth'
import AnswerComparisonChart from './AnswerComparisonChart.vue'
import AnswerQuestionAnalysis from './AnswerQuestionAnalysis.vue'
import { createRequestGate, runQuestionQueue } from './answerExecution.mjs'
import { answerGroups, answerMetrics, answerReport, answerTable, metricFormat } from './answerMetrics.mjs'
const auth = useAuthStore()
const batchPollError = ref(''), batchLastSync = ref(0)
const batchId = ref(''), batch = ref(null), batches = ref([]), selectedBatch = ref(''), page = ref(1)
const graphDetail = ref(null)
const batchRunning = computed(() => ['queued', 'running'].includes(batch.value?.status))
const visibleRuns = computed(() => runs.value.slice((page.value - 1) * 10, page.value * 10))
const questions = ref(''), knowledgeId = ref(DEFAULT_KNOWLEDGE_ID), reference = ref(''), k = ref(5), models = ref([]), judgeModel = ref('')
const generation = ref({ model: '', temperature: recommended.temperature, maxTokens: recommended.maxTokens, systemPrompt: miniappPrompt.systemPrompt })
function restoreDefaults() {
  Object.assign(generation.value, { temperature: recommended.temperature, maxTokens: recommended.maxTokens, systemPrompt: miniappPrompt.systemPrompt })
  ElMessage.success('已恢复推荐温度、输出预算和基础提示词')
}
const runs = ref([]), history = ref([]), historyIds = ref([]), busy = ref(false), stopped = ref(false), phase = ref(''), detail = ref(null), upload = ref(null), chart = ref(null)
const exporting = ref(false)
const paired = ref(false), metric = ref('overview'), recovery = ref([])
const sessionKey = 'rag-answer-comparison-v1'
const knowledgeIds = computed(() => [...new Set(knowledgeId.value.split(/[\s,，;；]+/).filter(Boolean))])
const queries = computed(() => [...new Set(questions.value.split('\n').map(item => item.trim()).filter(Boolean))])
const report = computed(() => answerReport(runs.value, paired.value))
const tableRows = computed(() => answerTable(runs.value, paired.value))
const chartOptions = { overview: '五项质量指标总览', ...answerMetrics, generationMs: '检索＋生成耗时 ms', judgeMs: '评审耗时 ms' }
const now = ref(Date.now()), pending = ref({})
const gate = createRequestGate()
let ticker, recoveryPoll
let recovering = false
const completed = computed(() => runs.value.reduce((n, run) => n + Object.values(run.variants || {}).filter(v => v.judge && v.judge.status !== 'partial').length, 0))
const totalGroups = computed(() => (batch.value?.queries.length || runs.value.length) * 5)
const stageName = stage => ({ rubric: 'GLM-4.7 制定评审标准', 'retrieve:knowledge': '检索文档', 'retrieve:graph': '检索知识图谱', 'judge:batch': 'GLM-4.7 集中评审'  }[stage] || (stage?.startsWith('generate:') ? `${stage.split(':')[1]}组 · GLM-5.3 生成回答` : stage?.startsWith('judge:') ? `${stage.split(':')[1]}组 · GLM-4.7 评审` : '等待当前阶段完成'))
function runStatus(run) {
  const state = pending.value[run._id]
  const progress = run.progress
  if (!state && !run.active) return ''
  if (!state && run.active && now.value - Date.parse(run.active.at) > 900000) return '上次执行已中断，可重试未完成阶段'
  const start = progress?.startedAt || state?.startedAt || run.active?.at
  return `${stageName(progress?.stage || state?.stage).replace('GLM-4.7', run.judgeModel).replace('GLM-5.3', run.generation.model)} · 已等待 ${Math.max(0, Math.floor((now.value - Date.parse(start)) / 1000))} 秒`
}
function streamProgress(run, key) {
  if (run.generationStatus?.[key] !== 'running') return ''
  const call = [...(run.calls || [])].reverse().find(c => c.stage === `generate:${key}`)
  return call?.answerChars ? `已接收正文 ${call.answerChars} 字` : call?.reasoningChars ? `正在思考 · 已接收 ${call.reasoningChars} 字` : '等待模型首次输出'
}
const fmt = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
const number = value => Number.isFinite(value) ? value.toFixed(0) : '—'
function usageSummary(run) {
  const calls = run.calls || []
  return { generated: calls.filter(c => c.stage.startsWith('generate:')).length,
    standards: calls.filter(c => c.stage === 'rubric').length,
    reviews: calls.filter(c => c.stage.startsWith('judge:')).length,
    retries: calls.filter(c => c.attempt > 1).length,
    total: calls.length,
    tokens: calls.length && calls.every(c => Number.isFinite(c.usage?.total_tokens)) ? calls.reduce((n, c) => n + c.usage.total_tokens, 0) : null,
    knownTokens: calls.reduce((n, c) => n + (c.usage?.total_tokens || 0), 0),
    missingUsage: calls.filter(c => !Number.isFinite(c.usage?.total_tokens)).length }
}
const totals = computed(() => usageSummary({ calls: runs.value.flatMap(run => run.calls || []) }))

function remember() { try { sessionStorage.setItem(sessionKey, JSON.stringify(runs.value.map(run => run._id))) } catch {} }
function update(run) { const old = runs.value.find(item => item._id === run._id); if (old?.updatedAt > run.updatedAt) return; const i = runs.value.findIndex(item => item._id === run._id); if (i < 0) runs.value.push(run); else runs.value[i] = run; remember() }
async function refreshHistory() { history.value = (await api.get('/rag-tuning/answer-tests')).data.experiments }
onMounted(async () => {
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
  recoveryPoll = setInterval(async () => {
    if (recovering) return
    if (batchId.value && !batchRunning.value && !batchPollError.value) return
    if (batchId.value) {
      recovering = true
      try { await loadBatch(batchId.value) } catch (error) { batchPollError.value = error.response?.data?.error || error.message || '无法读取后台进度' } finally { recovering = false }
      return
    }
    const active = runs.value.filter(run => run.active && !pending.value[run._id] && Date.now() - Date.parse(run.active.at) < 900000)
    recovering = true
    try { await Promise.allSettled(active.map(async run => update((await api.get(`/rag-tuning/answer-tests/${run._id}`)).data.experiment))) }
    finally { recovering = false }
  }, 4000)
  try {
    recovery.value = JSON.parse(sessionStorage.getItem(sessionKey) || '[]')
    const { data } = await api.get('/rag-tuning/settings'); models.value = data.models
    generation.value.model = 'glm-5.3'; judgeModel.value = 'glm-4.7'
    const savedBatch = localStorage.getItem('rag-answer-batch-id')
    await Promise.allSettled([
      refreshHistory().catch(error => ElMessage.warning('历史列表加载失败：' + (error.response?.data?.error || error.message))),
      api.get('/rag-tuning/answer-tests/batches').then(({data}) => { batches.value = data.batches }).catch(error => ElMessage.warning('批次列表加载失败：' + (error.response?.data?.error || error.message))),
      savedBatch ? loadBatch(savedBatch).catch(error => { batchId.value = savedBatch; batchPollError.value = error.response?.data?.error || error.message; ElMessage.error(batchPollError.value) }) : Promise.resolve()
    ])
  } catch (error) { ElMessage.error(error.response?.data?.error || error.message) }
})
onBeforeUnmount(() => { stopped.value = true; clearInterval(ticker); clearInterval(recoveryPoll) })
async function load(ids) {
  if (busy.value) return
  page.value = 1
  batchId.value = ''; batch.value = null; localStorage.removeItem('rag-answer-batch-id')
  busy.value = true; runs.value = []; stopped.value = false
  try { for (const id of ids) { if (stopped.value) break; update((await api.get(`/rag-tuning/answer-tests/${id}`)).data.experiment) } }
  catch (error) { ElMessage.error(error.response?.data?.error || error.message) }
  finally { busy.value = false }
}
async function step(id, path, body = {}) {
  await gate()
  if (stopped.value) throw new Error('已停止，尚未开始的阶段已保留')
  const match = path.match(/^variants\/([A-E])\/(generate|judge)$/)
  pending.value[id] = { stage: match ? `${match[2]}:${match[1]}` : '', startedAt: new Date().toISOString() }
  let done = false, polling = false
  const poll = setInterval(async () => {
    if (polling || done || stopped.value) return
    polling = true
    try { const { data } = await api.get(`/rag-tuning/answer-tests/${id}`); if (!done) update(data.experiment) } catch {} finally { polling = false }
  }, 4000)
  try { const { data } = await api.post(`/rag-tuning/answer-tests/${id}/${path}`, body, { timeout: 900000 }); update(data.experiment); return data.experiment }
  finally { done = true; clearInterval(poll); delete pending.value[id] }
}
async function processQuestions(items, worker) {
  await runQuestionQueue(items, async item => {
    try { await worker(item) }
    catch (error) {
      if (item?._id) { try { update((await api.get(`/rag-tuning/answer-tests/${item._id}`)).data.experiment) } catch {} }
      ElMessage.error(error.response?.data?.error || error.message)
      if ([401, 403, 429].includes(error.response?.status)) stopped.value = true
    }
  }, () => stopped.value, 1)
}
async function execute(run, reviewOnly = false) {
  let current = run
  if (!reviewOnly) {
    if (!current.prepared || !current.graph) current = await step(run._id, 'prepare')
    if (stopped.value) return
    phase.value = `生成本题五组回答：${run.query}`
    current = await step(run._id, 'generate')
  }
  if (stopped.value) return
  phase.value = `制定本题统一标准：${run.query}`
  current = await step(run._id, 'rubric')
  if (stopped.value) return
  phase.value = `集中评审本题回答：${run.query}`
  try { current = await step(run._id, 'judge') }
  finally { update((await api.get(`/rag-tuning/answer-tests/${run._id}`)).data.experiment) }
}
async function loadBatch(id) {
  const { data } = await api.get(`/rag-tuning/answer-tests/batches/${id}`)
  batchId.value = id; batch.value = data.batch
  batchPollError.value = ''; batchLastSync.value = Date.now()
  localStorage.setItem('rag-answer-batch-id', id)
  runs.value = Object.entries(data.batch.summaries || {}).sort(([a], [b]) => Number(a) - Number(b)).map(([, run]) => ({ ...data.batch.settings, ...run, graph: run.graphReady ? [] : undefined, batchId: id, summaryOnly: true }))
  busy.value = ['queued', 'running'].includes(data.batch.status)
  phase.value = `批次 ${data.batch.queries.length - data.batch.pending.length}/${data.batch.queries.length} 题已处理 · ${data.batch.status === 'completed' ? '执行完成' : data.batch.status === 'paused' || data.batch.status === 'interrupted' ? '已暂停，可继续' : data.batch.status === 'completed_with_errors' ? '已结束，有失败题可继续' : '后台执行中'}`
}
async function start(resume = false) {
  if (busy.value) return
  if (resume && batchId.value) {
    await api.post(`/rag-tuning/answer-tests/batches/${batchId.value}/resume`)
    await loadBatch(batchId.value); return
  }
  if (resume) {
    busy.value = true; stopped.value = false
    try { await processQuestions([...runs.value], execute) } finally { busy.value = false }
    return
  }
  if (!queries.value.length || queries.value.length * Math.max(1, knowledgeIds.value.length) > 100 || queries.value.some(q => q.length > 1000)) return ElMessage.warning('问题数×知识库数最多100，每题不超过1000字')
  busy.value = true; stopped.value = false; page.value = 1
  try {
    const { data } = await api.post('/rag-tuning/answer-tests/batches', { queries: queries.value, knowledgeId: knowledgeIds.value[0] || '', knowledgeIds: knowledgeIds.value.length ? knowledgeIds.value : [''], k: k.value, reference: reference.value, generation: generation.value, judgeModel: judgeModel.value })
    await loadBatch(data.batch._id)
    batches.value = (await api.get('/rag-tuning/answer-tests/batches')).data.batches
  } catch (error) { busy.value = false; ElMessage.error(error.response?.data?.error || error.message) }
}
async function pauseBatch() {
  if (batchId.value) { await api.post(`/rag-tuning/answer-tests/batches/${batchId.value}/pause`); ElMessage.info('已请求暂停，将在当前阶段结束后生效') }
  else stopped.value = true
}
async function showDetail(run, key) {
  try {
    const current = run.summaryOnly ? (await api.get(`/rag-tuning/answer-tests/${run._id}`)).data.experiment : run
    detail.value = { run: current, key }
  } catch (error) { ElMessage.error(error.response?.data?.error || error.message) }
}
async function showGraph(run) {
  try {
    const current = run.summaryOnly ? (await api.get(`/rag-tuning/answer-tests/${run._id}`)).data.experiment : run
    graphDetail.value = current.graphSnapshot?.sourceInfo?.neo4j || { error: current.graphError || '暂无图谱诊断' }
  } catch (error) { ElMessage.error(error.response?.data?.error || error.message) }
}
async function repairLocal() {
  busy.value = true
  try {
    for (const run of [...runs.value]) {
      const { data } = await api.post(`/rag-tuning/answer-tests/${run._id}/repair`)
      update(data.experiment)
    }
    if (batchId.value) { await api.post(`/rag-tuning/answer-tests/batches/${batchId.value}/refresh`); await loadBatch(batchId.value) }
    ElMessage.success('已重新解析已保存的评审结果，未调用模型')
  } catch (error) { ElMessage.error(error.response?.data?.error || error.message) }
  finally { busy.value = false }
}
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function exportReport() {
  if (exporting.value) return
  exporting.value = true
  const selected = [...runs.value], usePaired = paired.value
  try {
    const experiments = []
    for (const run of selected) experiments.push(run.summaryOnly ? (await api.get(`/rag-tuning/answer-tests/${run._id}`)).data.experiment : run)
    const { exportAnswerWorkbook } = await import('./answerExport.mjs')
    download('五组回答评估完整报告.xlsx', exportAnswerWorkbook(experiments, usePaired), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  } catch (error) { ElMessage.error(error.response?.data?.error || error.message) }
  finally { exporting.value = false }
}
async function exportPNG() {
  try { download('五组回答质量折线对比.png', await chart.value.exportPNG(), 'image/png') }
  catch (error) { ElMessage.error(error.message) }
}
async function importFile(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  try { if (file.size > 1000000) throw new Error('文件不能超过1MB'); const text = await file.text(); const list = file.name.endsWith('.json') ? JSON.parse(text) : text.split(/\r?\n/); if (!Array.isArray(list) || list.some(q => typeof q !== 'string')) throw new Error('JSON应为问题字符串数组'); questions.value = list.join('\n') }
  catch (error) { ElMessage.error(error.message) }
}
</script>
<template>
  <div class="answer-test">
    <h3>五组检索与生成回答对比</h3>
    <p class="hint">A 直接回答；B 文档；C 文档＋图谱；D 文档＋专家规范；E 文档＋图谱＋专家规范。五组共享问题、生成模型和参数、文档快照、评审标准；C/E共享图谱快照。只有D/E注入专家规范。</p>
    <el-card shadow="never">
      <p class="hint">GLM-5.3 系列不支持关闭思考，自动使用最低强度 low；GLM-4.7 评审关闭思考。</p>
      <el-input v-model="questions" type="textarea" :rows="4" :disabled="busy" placeholder="每行一道问题，最多100题；五组分别生成回答并进行盲评。" />
      <div class="actions"><el-button :disabled="busy" @click="upload.click()">导入问题 TXT / JSON</el-button><input ref="upload" type="file" hidden accept=".txt,.json" @change="importFile"><span>{{ queries.length }} 题 × {{ Math.max(1, knowledgeIds.length) }} 个库 × 5 组</span><el-input v-model="knowledgeId" :disabled="busy" placeholder="知识库ID，多个用逗号分隔；留空用默认库" style="width:360px" /><span>K</span><el-input-number v-model="k" :disabled="busy" :min="1" :max="20" /></div>
      <div class="actions"><span>生成模型</span><el-select v-model="generation.model" :disabled="busy" style="width:190px"><el-option v-for="m in models" :key="m" :label="m" :value="m" /></el-select><span>评审模型</span><el-select v-model="judgeModel" :disabled="busy" style="width:190px"><el-option v-for="m in models" :key="m" :label="m" :value="m" /></el-select></div>
      <p class="hint">评审隐藏组别标签。{{ judgeModel === generation.model ? '当前生成与评审使用同一模型，存在自评偏差。' : '不同评审模型仍属于模型估算，建议人工抽查。' }}</p>
      <el-collapse><el-collapse-item title="生成参数与人工参考标准"><div class="actions"><el-tag>推荐：温度0.1 · 输出上限4096</el-tag><el-button :disabled="busy" @click="restoreDefaults">恢复推荐参数</el-button></div><p class="hint">低温度减少随机波动；4096 Token为输出上限，表格记录实际Token用量。系统提示词复用小程序回答模板；D/E额外使用项目现有专家规范。</p>
        <div class="actions"><span>温度</span><el-input-number v-model="generation.temperature" :disabled="busy" :min="0" :max="1" :step="0.1" /><span>输出Token上限</span><el-input-number v-model="generation.maxTokens" :disabled="busy" :min="128" :max="4096" /></div>
        <el-input v-model="generation.systemPrompt" readonly type="textarea" :rows="9" placeholder="小程序共用系统提示词" />
        <el-input v-model="reference" :disabled="busy" type="textarea" :rows="3" maxlength="12000" :placeholder="recommended.referencePlaceholder" />
      </el-collapse-item></el-collapse>
      <div class="actions"><el-button type="primary" :disabled="!auth.isAdmin || busy || !queries.length || !generation.model" @click="start(false)">开始五组实验</el-button><el-button v-if="busy" :disabled="stopped" @click="pauseBatch">当前阶段完成后暂停</el-button><el-button :disabled="busy || !auth.isAdmin || (!runs.length && !batchId)" @click="start(true)">继续 / 重试未完成阶段</el-button></div>
      <p class="hint">新实验统一使用百分制分析标准v2。每批最多100个题目与知识库组合，后台执行并保存进度。默认两题并行、每题最多三组同时生成，全后台模型请求最多四路（可由服务端配置）。文档与图谱同时检索。正常每题7次模型调用；连接中断或评分校验失败最多自动补试一次，已保存回答和有效评分复用。关闭页面不影响后台批次，服务重启后可继续。继续旧实验时自动升级标准并归档旧评分，复用已有回答。图谱失败时保留可用组结果，恢复后补齐C/E并统一评审。</p>
    </el-card>
    <div class="actions"><el-button v-if="recovery.length" :disabled="busy" @click="load(recovery)">恢复上次实验</el-button><el-select v-model="historyIds" multiple :disabled="busy" placeholder="选择历史实验（最近30题）" style="width:420px"><el-option v-for="run in history" :key="run._id" :value="run._id" :label="`${run.query} · ${run.updatedAt}`" /></el-select><el-button :disabled="busy || !historyIds.length" @click="load(historyIds)">读取历史</el-button><span>{{ phase }}</span></div>
    <div class="actions"><el-select v-model="selectedBatch" placeholder="选择历史批次"><el-option v-for="item in batches" :key="item._id" :value="item._id" :label="`${item.total}题 · ${item.updatedAt}`" /></el-select><el-button :disabled="busy || !selectedBatch" @click="loadBatch(selectedBatch)">恢复批次</el-button><el-button :disabled="busy || !runs.length || !auth.isAdmin" @click="repairLocal">修复已存评分（不调用模型）</el-button></div>
    <el-alert v-if="batchPollError" type="warning" :closable="false" :title="`进度更新失败：${batchPollError}。最后同步于 ${batchLastSync ? new Date(batchLastSync).toLocaleTimeString() : '尚未同步'}；不能据此判断任务是否仍在运行，请勿重复提交。`" />
    <p v-if="batch?.progressDetailsDelayed" class="hint">后台仍在执行，当前阶段详情读取较慢，暂显示上次保存的进度。</p>
    <p v-if="batchRunning" class="hint">当前执行 {{ (batch.activeIds || []).length }} 题；上方计数仅统计整题处理结束。检索、生成、评审完成前计数可能保持不变。</p>
    <p v-for="run in runs.filter(r => r.active)" :key="`active-${run._id}`" class="hint">{{ run.query }}：{{ runStatus(run) }}</p>
    <template v-if="runs.length"><p v-if="batch && (batch.executionMs != null || batch.executionStartedAt)" class="hint">本批累计执行 {{ (((batch.executionMs || 0) + (batch.executionStartedAt && batchRunning ? Math.max(0, now - Date.parse(batch.executionStartedAt)) : 0)) / 60000).toFixed(1) }} 分钟（含检索、生成、评审与执行期间排队，不含暂停间隔）。</p>
      <div class="progress-panel"><div><b>{{ completed }} / {{ totalGroups }}</b><span>组已保存评审 · 累计 {{ totals.total }} 次调用 · Token {{ totals.tokens ?? `总量不完整（已知 ${totals.knownTokens}）` }}</span></div><el-progress :percentage="totalGroups ? Math.round(completed / totalGroups * 100) : 0" :stroke-width="10" /><p class="hint">生成/评审模型按各批次记录展示 · 按题执行。图谱失败或未命中会单独标记；缺失评分不计为零分。</p></div>
      <el-card shadow="never">
        <div class="actions"><h3>回答质量对比 · 模型估算</h3><el-checkbox v-model="paired">只统计五组均完成的题目</el-checkbox><el-select v-model="metric" style="width:210px"><el-option v-for="(name, key) in chartOptions" :key="key" :label="name" :value="key" /></el-select><el-button @click="exportPNG">导出图表</el-button><el-button :loading="exporting" :disabled="exporting" @click="exportReport">导出 Excel 完整报告</el-button></div>
        <p class="hint">默认展示各组已完成评分，样本数可能不同；勾选“五组均完成”后每项指标仅统计五组都有该项有效分数的共同题目，未完成时可能没有有效样本。</p><p class="hint">新版五项指标均为0–100分：专业准确性、工况适配性、引用支撑质量、结论依据充分性、回答完整性。先逐题评分，再按题等权平均；n为有效题数。缺失评分不作零分，旧标准单独统计。</p>
        <el-collapse><el-collapse-item title="百分制评分细则与失分依据"><p class="hint">专业准确性：核心事实60分、机理与因果解释25分、关键限定15分。工况适配性：条件匹配40分、措施可执行性35分、风险与验证25分。回答完整性：直接回答40分、解释深度35分、关键细节与边界25分。各项逐条分析、系统相加，不能直接凭印象给总分。</p><p class="hint">引用支撑质量及结论依据充分性：0分无支持或矛盾；1–39分仅主题相关；40–69分部分支持；70–89分主要支持但存在条件缺口；90–100分直接充分支持且范围匹配。引用正分必须能定位来源原文；无引用或确实无法判断时留空。</p><p class="hint">同等质量允许同分，不因用了图谱或专家规范加分。每项必须给出失分理由或满分依据。历史v1仍按0–4分及比例解释，不能与v2混合比较；查看历史不触发付费重评，继续旧批次时才升级并归档旧评分。</p></el-collapse-item></el-collapse>
        <AnswerComparisonChart ref="chart" :rows="report" :metric="metric" :title="chartOptions[metric]" />
        <p class="hint">耗时按各组所需的文档检索、图谱检索、专家规范准备与模型生成累计（含失败重试），再逐题平均；不含评审、排队和人工等待。共享检索计入各依赖组，不可跨组相加。旧记录缺少完整计时显示空白。</p>
        <el-table :data="tableRows"><el-table-column label="实验组 / 知识库" min-width="220"><template #default="{row}">{{ row.label }}<small v-if="!row.shared">{{ row.knowledgeLabel }} · {{ row.configLabel }} · {{ row.scoringVersion === 'analytic-100-v2' ? '百分制分析标准v2' : row.scoringVersion === 'anchored-v1' ? '分级标准' : '旧版二值' }}</small></template></el-table-column><el-table-column v-for="(name, key) in answerMetrics" :key="key" :label="name" min-width="130"><template #default="{ row }">{{ row.shared ? '—' : metricFormat(row.metrics[key].value, key, row.scoringVersion) }}<small v-if="!row.shared">n={{ row.metrics[key].samples }}</small></template></el-table-column><el-table-column label="检索＋生成均耗时 ms" min-width="130"><template #default="{ row }">{{ number(row.generationMs) }}<small v-if="!row.shared">n={{ row.timingSamples }}</small></template></el-table-column><el-table-column label="Token总量" min-width="150" fixed="right"><template #default="{ row }">{{ row.tokens ?? `不完整（已知 ${row.knownTokens}）` }}</template></el-table-column></el-table>
        <p class="hint">每题通常为5次独立生成＋1次标准制定＋1次集中评审。重复尝试已包含在总调用中，不再次相加。集中评审和标准制定的Token只按实际请求计一次，不重复分摊到五组；上游未返回usage时标明总量不完整。图谱内部模型Token上游未完整返回，不包含在本表。</p>
      </el-card>
      <AnswerQuestionAnalysis v-if="runs.length > 1" :runs="runs" />
      <h3>逐题回答与评审依据</h3><el-pagination v-model:current-page="page" :page-size="10" :total="runs.length" layout="prev, pager, next, total" />
      <el-card v-for="run in visibleRuns" :key="run._id" shadow="never" class="question">
        <h4>{{ run.query }}</h4><p v-if="run.phaseTimings" class="hint">已完成阶段累计：检索准备 {{ ((run.phaseTimings.prepare || 0) / 1000).toFixed(1) }}秒 · 生成 {{ ((run.phaseTimings.generate || 0) / 1000).toFixed(1) }}秒 · 标准制定 {{ ((run.phaseTimings.rubric || 0) / 1000).toFixed(1) }}秒 · 评审（含补评）{{ ((run.phaseTimings.judge || 0) / 1000).toFixed(1) }}秒</p><p v-if="runStatus(run)" class="running">{{ runStatus(run) }}</p><p v-if="run.graphEmpty" class="hint">图谱查询成功，但未命中相关关系；本题C/E没有新增图谱证据。</p><el-button v-if="run.hasGraphDiagnostics || run.graphSnapshot || run.graphError" text @click="showGraph(run)">图谱检索诊断</el-button><p v-if="run.graphError" class="error">{{ run.graphError }}</p><p v-if="run.lastError" class="error">{{ run.lastError }}</p><p class="hint">评审模型：{{ run.judgeModel }} · 统一核验依据：{{ run.graph ? '文档＋图谱' : '仅文档（图谱尚未就绪）' }}</p>
        <div class="variants"><div v-for="(label, key) in answerGroups" :key="key"><b>{{ label }}</b><p>{{ run.variants[key]?.judge ? (run.variants[key].judge.status === 'partial' ? '部分指标待补评' : '已评审') : (run.variants[key]?.answer || run.variants[key]?.hasAnswer) ? '待集中评审' : run.generationStatus?.[key] === 'running' ? '生成中' : run.stageErrors?.[key] ? '生成失败，可重试' : '待生成' }}{{ run.variants[key]?.finishReason === 'length' ? ' · 回答截断（不计质量均值）' : '' }}</p><p v-if="streamProgress(run, key)" class="hint">{{ streamProgress(run, key) }}</p><p v-if="run.stageErrors?.[key] || run.variants[key]?.error" class="error">{{ run.stageErrors?.[key] || run.variants[key]?.error }}</p><p v-if="run.variants[key]?.judge?.warnings?.length" class="hint">{{ run.variants[key].judge.warnings.join('；') }}</p><el-button text :disabled="!(run.variants[key]?.answer || run.variants[key]?.hasAnswer)" @click="showDetail(run, key)">查看回答与评分</el-button></div></div>
        <p class="hint" v-if="run.expert && !run.expert.context">本题未命中专家规范，D/E 实际未注入规范。</p>
      </el-card>
    </template>
    <el-dialog :model-value="!!detail" title="回答与内容评估" width="min(1100px,95vw)" @close="detail = null">
      <template v-if="detail"><h3>{{ answerGroups[detail.key] }} · {{ detail.run.query }}</h3><pre>{{ detail.run.variants[detail.key].answer }}</pre><p class="hint">生成模型：{{ detail.run.generation.model }}；评审模型：{{ detail.run.judgeModel }}；温度：{{ detail.run.generation.temperature }}；输出预算：{{ detail.run.generation.maxTokens }}；知识库：{{ detail.run.knowledgeId || '默认库' }}</p><h4>统一评审标准</h4><pre>{{ JSON.stringify(detail.run.rubric, null, 2) }}</pre><h4>逐项评审、分子分母及理由</h4><pre>{{ JSON.stringify(detail.run.variants[detail.key].judge || '尚未评审', null, 2) }}</pre><el-collapse><el-collapse-item title="实际提供的证据与专家规范状态"><pre>{{ JSON.stringify({ sources: detail.run.variants[detail.key].sources, expertApplied: detail.run.variants[detail.key].expertApplied, policy: detail.run.expert.metadata }, null, 2) }}</pre></el-collapse-item></el-collapse></template>
    </el-dialog>
    <el-dialog :model-value="!!graphDetail" title="图谱检索诊断" width="min(900px,95vw)" @close="graphDetail = null"><pre>{{ JSON.stringify(graphDetail, null, 2) }}</pre></el-dialog>
  </div>
</template>
<style scoped>
.progress-panel { margin:20px 0; padding:22px; border:1px solid #dbe7f4; border-radius:16px; background:#f5f9ff; } .progress-panel b { font-size:28px; color:#2347a1; margin-right:12px; } .progress-panel .el-progress { margin-top:14px; } .running { color:#315ac5; font-weight:600; }
.answer-test { max-width:1400px; margin:auto; } .actions { display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin:16px 0; } .actions h3 { margin-right:auto; } .hint,small { color:#748095; font-size:13px; line-height:1.8; } small { display:block; } h3,h4 { color:#243b53; } .question { margin:16px 0; } .variants { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; } .variants>div { padding:12px; background:#f3f6fb; border-radius:8px; } pre { white-space:pre-wrap; overflow-wrap:anywhere; padding:16px; background:#f5f7fa; max-height:500px; overflow:auto; } .error { color:#bc3434; } .el-textarea { margin:8px 0; }
</style>
