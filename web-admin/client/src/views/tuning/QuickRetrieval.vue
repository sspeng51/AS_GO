<script setup>
import { DEFAULT_KNOWLEDGE_ID } from './defaultKnowledge.mjs'
import { ref, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { quickMetrics, runState, buildReport } from './quickMetrics.mjs'
import RunReview from './RunReview.vue'
import { exportRetrievalWorkbook } from './retrievalExport.mjs'
const auth = useAuthStore()
const questions = ref(''), ids = ref(DEFAULT_KNOWLEDGE_ID), k = ref(5), busy = ref(false), stopped = ref(false)
const rows = ref([]), detail = ref(null), progress = ref(null), upload = ref(null), chart = ref(null)
const importCases = ref(new Map())
const names = { recallAtK: 'Recall@k', precisionAtK: 'Precision@k', mrr: 'MRR', ndcgAtK: 'NDCG@k', hitRate: 'Hit Rate', contextRelevance: '上下文相关性', evidenceUtility: '证据效用' }
const chartMetric = ref('precisionAtK')
const basis = ref('model'), paired = ref(false), filter = ref('all'), restored = ref(false), recovery = ref(null), reviewBusy = ref('')
const sessionKey = 'rag-quick-report-v3'
const batchId = ref(''), history = ref([]), selectedBatch = ref(''), judgeModel = ref('glm-4.7'), models = ref([])
const visibleNames = computed(() => names)
const filteredRows = computed(() => rows.value.filter(row => filter.value === 'all' || (filter.value === 'failed' ? ['retrievalFailed', 'judgeFailed', 'loadFailed'].includes(runState(row).key) : runState(row).key === filter.value)))
const counts = computed(() => ({ total: rows.value.length, complete: rows.value.filter(row => runState(row).key === 'complete').length, failed: rows.value.filter(row => ['retrievalFailed', 'judgeFailed', 'loadFailed'].includes(runState(row).key)).length, empty: rows.value.filter(row => runState(row).key === 'empty').length }))
const rerankNames = { enabled: '已重排', disabled: '未启用重排', fallback_off: '重排回退', fallback_mixed: '部分重排回退', unknown: '未记录重排', not_applicable: '不适用' }
const questionList = computed(() => [...new Set(questions.value.split('\n').map(v => v.trim()).filter(Boolean))])
const idList = computed(() => [...new Set(ids.value.split(/[\s,，;；]+/).filter(Boolean))])
const format = value => Number.isFinite(value) ? `${(value*100).toFixed(1)}分` : '—'
const report = computed(() => buildReport(rows.value, names, rerankNames, basis.value, paired.value))
const chartHeight = computed(() => 410 + report.value.length * 22)
const colors = ['#2563eb', '#e07828', '#16a085', '#9333ea', '#dc4563']
const chartMode = ref('aggregate')
const chartKeys = computed(() => chartMode.value === 'aggregate' ? Object.keys(names) : [...new Set(rows.value.map(row => row.query))])
const pointX = index => 80 + index * 730 / Math.max(1, chartKeys.value.length - 1)
const pointY = value => 300 - value * 230
const series = computed(() => report.value.map((group, index) => {
  const values = chartKeys.value.map(key => chartMode.value === 'aggregate' ? group.metrics[key].value : group.questions.find(item => item.query === key)?.metrics[chartMetric.value]?.value ?? null)
  let penDown = false
  const path = values.map((value, i) => {
    if (!Number.isFinite(value)) { penDown = false; return '' }
    const command = penDown ? 'L' : 'M'; penDown = true
    return `${command}${pointX(i)},${pointY(value)}`
  }).join(' ')
  return { ...group, values, path, color: colors[index % colors.length] }
}))
const metricCards = computed(() => rows.value.length === 1 ? Object.fromEntries(Object.keys(names).map(key => [key, quickMetrics(rows.value[0], basis.value)[key]])) : null)
const pending = computed(() => rows.value.filter(row => row._id && row.metrics?.eligible && row.results.length && !['running', 'loading', 'loadFailed'].includes(runState(row).key) && (['pending', 'judgeFailed'].includes(runState(row).key) || !row.testCase?.evidencePoints?.length || !row.judge?.referencePool)))
const retrievalFailures = computed(() => rows.value.filter(row => runState(row).key === 'retrievalFailed'))
function snapshot() {
  return { batchId:batchId.value, questions:[...new Set(rows.value.map(r=>r.query))].join('\n'), ids:[...new Set(rows.value.map(r=>r.targetId||''))].filter(Boolean).join(','), k:rows.value[0]?.k||k.value, judgeModel:judgeModel.value, runs:rows.value.map(r=>({_id:r._id,requestId:r.requestId,query:r.query,targetId:r.targetId||'',k:r.k,caseId:r.caseId,standard:r.standard,batchId:r.batchId})) }
}
function remember() {
  if(!rows.value.length)return
  const saved=snapshot(); recovery.value=saved
  try { localStorage.setItem(sessionKey,JSON.stringify(saved)) } catch {}
}
async function checkpoint() {
  remember()
  if(batchId.value){await api.put(`/rag-tuning/retrieval-batches/${batchId.value}`,snapshot());history.value=[{_id:batchId.value,total:rows.value.length,updatedAt:new Date().toISOString()},...history.value.filter(b=>b._id!==batchId.value)].slice(0,30)}
}
onMounted(async()=>{
  try { const saved=JSON.parse(localStorage.getItem(sessionKey)||sessionStorage.getItem('rag-quick-report-v2'));if(Array.isArray(saved?.runs)&&saved.runs.length<=500)recovery.value=saved } catch {}
  try { history.value=(await api.get('/rag-tuning/retrieval-batches')).data.batches;const settings=(await api.get('/rag-tuning/settings')).data;models.value=settings.models;if(!models.value.includes(judgeModel.value))judgeModel.value=models.value[0] } catch(e){ElMessage.warning('历史批次或模型配置读取失败，可刷新后重试')}
})
watch(()=>rows.value.map(r=>[r._id,r.error,r.autoError,r.judge?.id]),remember,{deep:true})
async function restoreReport(saved=recovery.value) {
  if(busy.value||!saved)return
  busy.value=true;stopped.value=false
  questions.value=saved.questions;ids.value=saved.ids;k.value=saved.k;judgeModel.value=saved.judgeModel||'glm-4.7';batchId.value=saved.batchId||saved._id||saved.runs[0]?.batchId||crypto.randomUUID()
  rows.value=saved.runs.map(r=>({...r,requestId:r.requestId||r._id||crypto.randomUUID(),batchId:batchId.value,results:[],queued:!r._id,loading:true}))
  progress.value={done:0,total:rows.value.length,phase:'恢复后台断点'}
  try {
    for(const row of rows.value){
      if(stopped.value)break
      try {
        const {data}=await api.get(`/rag-tuning/runs/${row._id||row.requestId}`)
        Object.assign(row,data.run,{queued:false,loading:false,autoError:data.run.judgeAttempt?.status==='failed'?data.run.judgeAttempt.error:''})
      } catch(e){row.loading=false;if(e.response?.status===404){row.queued=true;row._id=null}else row.loadError=e.response?.data?.error||e.message}
      progress.value.done++
    }
    restored.value=true;remember()
  } finally {busy.value=false;progress.value.phase='已恢复；点击断点续测继续未完成项';rows.value.forEach(r=>{if(r.loading){r.loading=false;r.loadError='尚未读取，请重新恢复'}})}
}
async function loadHistory(){
  try {const {data}=await api.get(`/rag-tuning/retrieval-batches/${selectedBatch.value}`);await restoreReport({...data.batch,batchId:data.batch._id})}catch(e){ElMessage.error(e.response?.data?.error||e.message)}
}
async function assess(row, force = false) {
  const { data } = await api.post(`/rag-tuning/runs/${row._id}/judge`, { model: judgeModel.value, skipExisting: !force, autoEvidencePoints: true, autoReferencePool: true }, { timeout: 360000 })
  const value = data.run || (await api.get(`/rag-tuning/runs/${row._id}`)).data.run
  Object.assign(row, value, { autoError: '', loadError: '' })
  return row
}
function updateDetail(value) {
  const index = rows.value.findIndex(row => row._id === value._id)
  if (index >= 0) rows.value[index] = { ...rows.value[index], ...value }
  detail.value = rows.value[index] || value
}
onBeforeUnmount(() => { stopped.value = true })
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function importFile(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  try {
    if (file.size > 1024 * 1024) throw new Error('问题文件不能超过 1 MB')
    const text = await file.text()
    const values = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : text.split(/\r?\n/).filter(v => v.trim())
    if (!Array.isArray(values) || values.length > 100 || values.some(v => typeof v !== 'string' && (!v || typeof v.query !== 'string'))) throw new Error('请导入最多 100 个问题，JSON 支持字符串数组或含 query 的对象数组')
    importCases.value = new Map(values.filter(v => typeof v === 'object').map(v => [JSON.stringify([v.query.trim(), v.knowledgeId || '']), v]))
    questions.value = values.map(v => typeof v === 'string' ? v : v.query).join('\n')
    ElMessage.success(`已导入 ${values.length} 个问题`)
  } catch (error) { ElMessage.error(error.message) }
}
async function continueBatch() {
  if(busy.value||reviewBusy.value)return
  if(rows.value.some(r=>r.loadError))return ElMessage.warning('请先恢复读取失败的记录，避免重复执行')
  busy.value=true;stopped.value=false
  const sharedPoints=new Map(rows.value.filter(r=>r.testCase?.evidencePoints?.length).map(r=>[r.query,r.testCase.evidencePoints]))
  const items=rows.value.filter(r=>r.queued||['retrievalFailed','judgeFailed','pending','running'].includes(runState(r).key))
  progress.value={done:0,total:items.length||1,phase:'断点续测'}
  try {
    await checkpoint()
    for(const row of items){
      if(stopped.value)break
      const started=Date.now()
      try {
        if(row.queued||!row.metrics?.eligible){
          if(row.standard&&!row.caseId){row.caseId=(await api.post('/rag-tuning/cases',{...row.standard,id:undefined,_id:undefined})).data.testCase._id;await checkpoint()}
          progress.value.phase=`检索：${row.query}`
          const {data}=await api.post('/rag-tuning/retrieve',{query:row.query,knowledgeId:row.targetId||'',requestId:row.requestId,k:row.k,retrievalMode:'knowledge',batchId:row.batchId,caseId:row.caseId||undefined,evidencePoints:sharedPoints.get(row.query)},{timeout:120000})
          Object.assign(row,data.run,{queued:false,error:data.run.error||'',autoError:''});await checkpoint()
        }
        if(row.metrics?.eligible&&row.results.length){progress.value.phase=`初评：${row.query}`;await assess(row);if(row.testCase?.evidencePoints?.length)sharedPoints.set(row.query,row.testCase.evidencePoints)}
      }catch(e){
        const message=e.response?.data?.error||e.message
        if(row.metrics?.eligible)row.autoError=message;else row.error=message
        if([401,403,409,429].includes(e.response?.status)){stopped.value=true;ElMessage.warning(message)}
      }
      progress.value.done++;await checkpoint()
      if(!stopped.value&&progress.value.done<progress.value.total)await new Promise(resolve=>setTimeout(resolve,Math.max(0,4200-(Date.now()-started))))
    }
  }catch(e){stopped.value=true;ElMessage.error('进度保存失败，已停止领取新任务：'+(e.response?.data?.error||e.message))}
  finally {busy.value=false;progress.value.phase=stopped.value?'已保存断点，可继续':'本轮完成；失败项可断点续测';remember()}
}
async function start() {
  if(busy.value||reviewBusy.value)return
  if(!questionList.value.length||questionList.value.length>100||questionList.value.some(q=>q.length>1000))return ElMessage.warning('请输入1–100个问题，每题不超过1000字')
  if(idList.value.length>5||idList.value.some(id=>!/^[a-zA-Z0-9_-]{1,128}$/.test(id)))return ElMessage.warning('最多5个知识库，请检查ID')
  batchId.value=crypto.randomUUID();detail.value=null;filter.value='all';restored.value=false
  const targets=idList.value.length?[...idList.value]:['']
  rows.value=questionList.value.flatMap(query=>targets.map(targetId=>{
    const supplied=importCases.value.get(JSON.stringify([query,targetId]))
    const standard=supplied?{...supplied,query,knowledgeId:targetId,retrievalMode:'knowledge',references:supplied.references||[],referencesComplete:supplied.referencesComplete===true,evidencePoints:supplied.evidencePoints||[],noAnswer:supplied.noAnswer??null}:null
    return {query,targetId,k:k.value,batchId:batchId.value,requestId:crypto.randomUUID(),standard,queued:true,results:[]}
  }))
  await continueBatch()
}
function exportTable(){
  try {download('知识库内容评估.xlsx',exportRetrievalWorkbook(rows.value,report.value,names,basis.value,paired.value),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}catch(e){ElMessage.error('表格导出失败：'+e.message)}
}
async function exportImage() {
  if (!chart.value) return
  const svg = new XMLSerializer().serializeToString(chart.value)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url })
    const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = chartHeight.value * 2
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('图片生成失败')
    download('知识库检索对比.png', blob, 'image/png')
  } catch { ElMessage.error('图片导出失败，请使用数据导出') }
  finally { URL.revokeObjectURL(url) }
}
</script>

<template>
  <div class="quick">
    <el-alert v-if="recovery && !busy && !reviewBusy" type="info" :closable="false" :title="`本页保留了 ${recovery.runs.length} 条运行记录的恢复入口`"><el-button text @click="restoreReport()">{{ restored ? '重新读取后台结果' : '恢复上次结果' }}</el-button><span>恢复只读取记录，不调用模型。</span></el-alert>
    <div class="actions"><el-select v-model="selectedBatch" placeholder="选择历史评估批次"><el-option v-for="item in history" :key="item._id" :value="item._id" :label="`${item.total}条 · ${item.updatedAt}`" /></el-select><el-button :disabled="busy || !selectedBatch" @click="loadHistory">恢复历史批次</el-button><el-button v-if="rows.length" type="primary" :disabled="busy || !auth.isAdmin || !!reviewBusy" @click="continueBatch">断点续测</el-button></div>
    <el-card shadow="never">
      <h3>知识库内容评估</h3><p class="hint">同一批问题评估多个知识库：逐题评分 → 各库指标平均值 → 对比与逐题趋势。</p>
      <el-input v-model="questions" type="textarea" :rows="5" :disabled="busy" placeholder="输入一个问题，或每行输入一个问题。也可以导入 TXT / JSON 问题列表。" />
      <div class="actions"><el-button :disabled="busy" @click="upload.click()">导入问题</el-button><span>{{ questionList.length }} 个问题</span><input ref="upload" hidden type="file" accept=".txt,.json" @change="importFile"></div>
      <el-input v-model="ids" :disabled="busy" placeholder="智谱知识库 ID，留空使用默认库；多个 ID 用逗号分隔，即可对比" />
      <div class="actions"><el-button type="primary" :disabled="!auth.isAdmin || busy || !!reviewBusy || !questionList.length" :loading="busy" @click="start">开始自动评估</el-button><el-button v-if="busy" :disabled="stopped" @click="stopped = true">{{ stopped ? '正在停止…' : '当前题完成后停止' }}</el-button><span>{{ questionList.length * Math.max(idList.length, 1) }} 次检索 · 自动模型评估</span></div>
      <el-collapse><el-collapse-item title="更多设置" name="settings"><span>初评模型 </span><el-select v-model="judgeModel" :disabled="busy"><el-option v-for="model in models" :key="model" :label="model" :value="model" /></el-select><span>评估截断位置 K </span><el-input-number v-model="k" :min="1" :max="20" :disabled="busy" /><p>LLM 自动生成证据点，并对本次候选资料按 0 无关、1 背景相关、2 直接支撑评分，形成候选池参考标准。Recall / NDCG 的模型估算仅针对这个资料池；上传完整人工标准可计算正式值。任务清单和阶段结果保存到后台；关闭页面会暂停领取新任务，恢复历史批次后可断点续测，已完成项不重复调用。</p></el-collapse-item></el-collapse>
    </el-card>
    <div v-if="progress" class="progress"><el-progress :percentage="Math.round(progress.done / progress.total * 100)" /><span>{{ progress.done }} / {{ progress.total }} · {{ progress.phase }}</span></div>
    <template v-if="rows.length">
      <div class="overview"><div>运行记录 <b>{{ counts.total }}</b></div><div>已完成初评 <b>{{ counts.complete }}</b></div><div>需重试 <b>{{ counts.failed }}</b></div><div>未找到证据 <b>{{ counts.empty }}</b></div></div>
      <p class="hint">断点续测会跳过已完成项，初评失败复用检索资料；未开始或检索失败的题目继续检索。</p>
      <div v-if="metricCards" class="cards">
        <div><small>检索耗时</small><b>{{ rows[0].latencyMs ?? '—' }} ms</b></div><div><small>实际返回 / K</small><b>{{ rows[0].results.length }} / {{ rows[0].k ?? '—' }}</b></div>
        <div v-for="(item, key) in metricCards" :key="key"><small>{{ names[key] }}</small><b>{{ format(item.value, key) }}</b><small>{{ item.basis }}</small></div>
      </div>
      <p class="hint">全部指标以0–100分展示，保留原始计算定义。MRR为倒数排名×100；单题命中为0或100，汇总按题平均。证据效用为返回资料细评分总和÷K，兼顾质量与返回数量。上下文相关性按直接支持50分、工况与范围匹配30分、细节充分性20分逐项相加后取均值；旧记录及人工标注仍按0/1/2等级换算。Precision 的分母为 K，返回不足 K 也按 K 计算。候选池 Recall / NDCG 不代表全库召回能力。</p>
      <el-card shadow="never">
        <div class="actions"><h3>评估报告与知识库对比</h3><el-select v-if="chartMode === 'questions'" v-model="chartMetric" style="width:180px"><el-option v-for="(name, key) in names" :key="key" :label="name" :value="key" /></el-select><el-button :disabled="busy || !report.length" @click="exportImage">导出图片</el-button><el-button :disabled="busy" @click="exportTable">导出 Excel 表格</el-button><el-button :disabled="busy" @click="download('检索评估报告.json', JSON.stringify({ scoringBasis: basis, commonQuestionsOnly: paired, report, runs: rows }, null, 2), 'application/json')">导出数据</el-button></div>
        <div class="actions"><el-radio-group v-model="basis"><el-radio-button value="model">模型估算</el-radio-button><el-radio-button value="confirmed">已确认指标</el-radio-button></el-radio-group><el-checkbox v-model="paired">仅比较共同有效问题</el-checkbox><el-radio-group v-model="chartMode"><el-radio-button value="aggregate">聚合指标折线</el-radio-button><el-radio-button value="questions">逐题趋势</el-radio-button></el-radio-group></div>
        <p class="hint">按知识库、K、重排状态、初评模型与评分版本分组，模型估算与确认值分开展示。勾选共同问题时，仅在相同评估配置的知识库之间取交集，表中 n 为该指标实际参与平均的题数。无共同有效样本时不作比较。</p>
        <el-alert v-if="!series.some(g => g.values.some(Number.isFinite))" title="当前筛选无有效分数；可取消共同问题筛选或切换评分依据。缺失评分不会补成零。" type="info" :closable="false" />
        <svg ref="chart" xmlns="http://www.w3.org/2000/svg" :viewBox="`0 0 900 ${chartHeight}`" role="img" aria-label="知识库指标对比折线图" style="width:100%;font-family:Arial,sans-serif">
          <rect width="900" :height="chartHeight" fill="#fff" />
          <text x="24" y="30" font-size="18" fill="#243b53">知识库对比 · {{ chartMode === 'aggregate' ? '各指标均值' : names[chartMetric] + ' 逐题趋势' }} · {{ basis === 'model' ? '模型估算' : '已确认指标' }}</text>
          <g v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="tick"><line x1="80" x2="810" :y1="pointY(tick)" :y2="pointY(tick)" stroke="#e2e8f0" /><text x="28" :y="pointY(tick) + 4" font-size="12" fill="#64748b">{{ format(tick, 'mrr') }}</text></g>
          <text v-for="(key, i) in chartKeys" :key="key" :x="pointX(i)" y="325" :visibility="chartMode === 'aggregate' || i % Math.max(1, Math.ceil(chartKeys.length / 10)) === 0 || i === chartKeys.length - 1 ? 'visible' : 'hidden'" text-anchor="middle" font-size="12" fill="#334155">{{ chartMode === 'aggregate' ? names[key] : `Q${i + 1}` }}</text>
          <g v-for="(group, index) in series" :key="group.key">
            <path :d="group.path" fill="none" :stroke="group.color" stroke-width="2.5" />
            <template v-for="(value, i) in group.values" :key="i"><circle v-if="Number.isFinite(value)" :cx="pointX(i)" :cy="pointY(value)" r="8" fill="transparent"><title>{{ group.label }} · {{ chartMode === 'aggregate' ? names[chartKeys[i]] : chartKeys[i] }}：{{ format(value, chartMode === 'aggregate' ? chartKeys[i] : chartMetric) }}</title></circle></template>
            <line x1="24" x2="44" :y1="360 + index * 22" :y2="360 + index * 22" :stroke="group.color" stroke-width="3" /><text x="52" :y="364 + index * 22" font-size="11" fill="#334155">{{ group.label }}</text>
          </g>
          <text x="24" :y="chartHeight - 12" font-size="11" fill="#64748b">图表与表格统一为0–100分；不人为拉开分差。缺失值断线。候选池估算不代表完整标准下的 Recall / NDCG。</text>
        </svg>
        <el-table :data="report"><el-table-column prop="label" label="知识库 / 评估配置" min-width="200" /><el-table-column prop="count" label="题数" width="60" /><el-table-column label="检索 / 初评失败" width="105"><template #default="{ row }">{{ row.failures }} / {{ row.judgeFailures }}</template></el-table-column><el-table-column prop="latency" label="平均耗时 ms" width="100" /><el-table-column v-for="(name, key) in visibleNames" :key="key" :label="name" min-width="120"><template #default="{ row }">{{ format(row.metrics[key].value, key) }}<div class="hint">{{ row.metrics[key].basis || '缺少标准' }} · n={{ row.metrics[key].samples }}</div></template></el-table-column></el-table>
      </el-card>
      <div class="actions"><h3>逐题结果</h3><el-select v-model="filter" style="width:180px"><el-option label="全部记录" value="all" /><el-option label="仅需重试" value="failed" /><el-option label="评估完成" value="complete" /><el-option label="未找到证据" value="empty" /><el-option label="待模型评估" value="pending" /><el-option label="待检索" value="queued" /></el-select></div>
      <el-table :data="filteredRows" empty-text="没有符合当前筛选条件的记录"><el-table-column label="题号" width="65"><template #default="{ row }">Q{{ [...new Set(rows.map(item => item.query))].indexOf(row.query) + 1 }}</template></el-table-column><el-table-column prop="query" label="问题" min-width="180" /><el-table-column label="知识库" min-width="130"><template #default="{ row }"><span :title="row.knowledgeBase?.id || row.targetId">{{ row.knowledgeBase?.name || row.knowledgeBase?.id || row.targetId || '默认知识库' }}</span></template></el-table-column><el-table-column v-for="(name, key) in names" :key="key" :label="name" min-width="135"><template #default="{ row }">{{ format(quickMetrics(row, basis)[key].value, key) }}<div class="hint">{{ quickMetrics(row, basis)[key].basis }}</div></template></el-table-column><el-table-column label="状态 / 问题" min-width="230"><template #default="{ row }"><el-tag :type="runState(row).type">{{ runState(row).label }}</el-tag><div class="hint">{{ row.loadError || row.error || row.autoError || row.judgeAttempt?.error || (!row.queued && !row.results.length ? '需确认库内是否有答案' : '') }}</div></template></el-table-column><el-table-column label="证据" width="110"><template #default="{ row }"><el-button text :disabled="busy || !row._id || !!row.loadError || row.loading" @click="detail = row">查看 / 复核</el-button></template></el-table-column></el-table>
    </template>
    <el-dialog :model-value="!!detail" :close-on-click-modal="!reviewBusy" :close-on-press-escape="!reviewBusy" :show-close="!reviewBusy" title="检索证据与复核" width="min(1100px, 95vw)" @close="detail = null"><RunReview v-if="detail" :key="detail._id" :run="detail" @update="updateDetail" @busy="value => reviewBusy = value" /></el-dialog>
  </div>
</template>

<style scoped>
.quick { max-width: 1250px; margin: 0 auto; }
h3 { margin: 0 0 16px; color: #243b53; }
.actions { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin:16px 0; }
.actions h3 { margin:0; margin-right:auto; }
.actions span,.hint,.progress { font-size:13px; color:#738097; line-height:1.8; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(155px,1fr)); gap:12px; margin-top:20px; }
.cards > div { background:#f3f6fb; padding:16px; border-radius:10px; }
.cards small { display:block; color:#738097; font-size:12px; }
.cards b { display:block; font-size:22px; margin:10px 0; color:#294668; }
.progress { padding:18px 0; }
.overview { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; margin:20px 0; }
.overview > div { padding:18px; background:#f3f6fb; border-radius:10px; color:#65778a; }
.overview b { display:block; margin-top:8px; font-size:26px; color:#243b53; }
.quick > .el-alert { margin-bottom:16px; }
</style>
