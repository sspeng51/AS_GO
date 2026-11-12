<script setup>
import { DEFAULT_KNOWLEDGE_ID } from './defaultKnowledge.mjs'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'
import { importQuestions as readQuestions } from './evidenceAutoIO.mjs'
import { mode, groups, metrics, format, batchRuns, metricValue, summarize, exportWorkbook } from './factualMetrics.mjs'
const root = '/rag-tuning/answer-tests'
const questions = ref(''), knowledgeId = ref(DEFAULT_KNOWLEDGE_ID), generationModel = ref('glm-5.3'), judgeModel = ref('glm-4.7'), k = ref(5)
const models = ref([]), batch = ref(null), history = ref([]), selected = ref(''), upload = ref(null), busy = ref(false), paired = ref(false), page = ref(1), detail = ref(null)
const queries = computed(() => [...new Set(questions.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean))])
const running = computed(() => ['queued','running'].includes(batch.value?.status))
const runs = computed(() => batchRuns(batch.value))
const report = computed(() => summarize(runs.value,paired.value))
const visible = computed(() => runs.value.slice((page.value-1)*10,page.value*10))
const colors = ['#4361ee','#059669','#d97706','#8b5cf6','#e4487b']
const statusLabels = { queued:'排队中', running:'执行中', paused:'已暂停', interrupted:'已中断，可续测', completed:'已完成', completed_with_errors:'已结束，有失败项可续测' }
let timer, polling = false, disposed = false
function error(e) { ElMessage.error(e.response?.data?.error || e.message) }
async function refreshHistory() { history.value = (await api.get(`${root}/batches`, { params: { evaluationMode: mode } })).data.batches }
async function load(id) {
  const next = (await api.get(`${root}/batches/${id}`)).data.batch
  if (next.settings.evaluationMode !== mode) throw new Error('该记录不是四指标实验')
  if (disposed) return
  batch.value = next; selected.value = id; localStorage.setItem('rag-factual-batch',id)
}
async function selectBatch(id) { try { page.value=1; await load(id) } catch(e) { error(e) } }
async function start() {
  busy.value = true
  try {
    const knowledgeIds = knowledgeId.value.split(/[,，\s]+/).filter(Boolean)
    const {data} = await api.post(`${root}/batches`, { evaluationMode: mode, queries: queries.value, knowledgeId: knowledgeIds[0] || '', knowledgeIds: knowledgeIds.length ? knowledgeIds : [''], k: k.value, generation: { model: generationModel.value, thinking: 'disabled' }, judgeModel: judgeModel.value })
    page.value=1; await load(data.batch._id); await refreshHistory()
  } catch(e) { error(e) } finally { busy.value=false }
}
async function action(name) {
  busy.value=true
  try { await api.post(`${root}/batches/${batch.value._id}/${name}`); await load(batch.value._id) } catch(e) { error(e) } finally { busy.value=false }
}
async function importQuestions(event) {
  const file=event.target.files?.[0]
  if (!file) return
  try {
    questions.value=(await readQuestions(file)).join('\n')
    ElMessage.success(`已导入${queries.value.length}个问题，无需参考答案或人工标注`)
  } catch(e) { error(e) } finally { event.target.value='' }
}
function rowStatus(r,g) {
  const v=r.variants?.[g]
  if(v?.finishReason==='length') return '回答截断，不计汇总'
  if(v?.judge?.status==='unassessable') return '证据不足，无法评估'
  if(v?.judge) return Object.keys(metrics).some(m => metricValue(r,g,m)===null) ? '已评估，部分指标不可判定' : '已完成'
  return v?.error || r.stageErrors?.[g] || (['C','E'].includes(g) && r.graphError) || (v?.hasAnswer ? '待评审' : '待生成')
}
async function show(r) { try { detail.value=(await api.get(`${root}/${r._id}`)).data.experiment } catch(e) { error(e) } }
async function repairScores() {
  busy.value=true
  try {
    for(const r of runs.value.filter(r=>!r.pendingRecord)) await api.post(`${root}/${r._id}/repair`,{})
    await api.post(`${root}/batches/${batch.value._id}/refresh`,{})
    await load(batch.value._id)
    ElMessage.success('已从保存的评审输出恢复评分，未调用模型；仍缺失的项目可续测')
  } catch(e) { error(e) } finally { busy.value=false }
}
async function downloadReport() {
  busy.value=true
  try {
    const full=[]
    for(const r of runs.value) full.push(r.pendingRecord ? r : (await api.get(`${root}/${r._id}`)).data.experiment)
    const url=URL.createObjectURL(new Blob([exportWorkbook(full,paired.value)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
    const a=document.createElement('a');a.href=url;a.download='五组Accuracy-Precision-Recall-F1.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  } catch(e) { error(e) } finally { busy.value=false }
}
onMounted(async () => {
  try {
    models.value=(await api.get('/rag-tuning/settings')).data.models
    await refreshHistory()
    const saved=localStorage.getItem('rag-factual-batch');if(saved) await load(saved)
  } catch(e) { error(e) }
  if(disposed) return
  timer=setInterval(async()=>{
    if(!batch.value || !running.value || polling) return
    polling=true
    try { await load(batch.value._id) } catch(e) { error(e) } finally { polling=false }
  },5000)
})
onBeforeUnmount(()=>{disposed=true;clearInterval(timer)})
</script>

<template>
  <section class="factual">
    <h3>五组自动评估 · Accuracy / Precision / Recall / F1</h3>
    <el-alert :closable="false" type="info" title="上传问题即可自动执行。评估对象是五组最终回答；共同标准和事实判定由大语言模型生成，结果属于模型估计。" />
    <p class="muted">五组独立生成 → 制定同一套有证据的必要要点 → 随机匿名集中评审 → 程序计算指标。正常每题7次回答/评审调用；评分缺失时自动局部补评，证据不足或仍有未知项时最多追加一轮补检索与共同评审，额外调用及Token均记录。检索内部调用另计。无需人工标准，不预设组别优劣。沿用后台模型参数适配：5.3使用low思考强度，4.7关闭思考。</p>
    <el-input v-model="questions" type="textarea" :rows="5" placeholder="每行一个问题，或导入 XLSX / CSV / TXT / JSON。Excel首表使用Question或问题列，仅读取问题，不需要参考答案。每批最多100个问题×知识库组合。" :disabled="running || busy" />
    <div class="actions">
      <el-button :disabled="running || busy" @click="upload.click()">上传问题 XLSX / CSV / TXT / JSON</el-button><input ref="upload" hidden type="file" accept=".xlsx,.csv,.txt,.json" @change="importQuestions">
      <span>{{ queries.length }} 个问题</span>
      <el-input v-model="knowledgeId" style="width:320px" placeholder="知识库ID，可多个；留空使用默认库" :disabled="running || busy" />
      <span>Top K</span><el-input-number v-model="k" :min="1" :max="20" :disabled="running || busy" />
    </div>
    <div class="actions">
      <span>生成模型</span><el-select v-model="generationModel" style="width:180px" :disabled="running || busy"><el-option v-for="m in models" :key="m" :value="m" :label="m" /></el-select>
      <span>评审模型</span><el-select v-model="judgeModel" style="width:180px" :disabled="running || busy"><el-option v-for="m in models" :key="m" :value="m" :label="m" /></el-select>
      <el-button type="primary" :loading="busy" :disabled="running || !queries.length || queries.length>100" @click="start">开始自动实验</el-button>
      <el-button v-if="running" :disabled="busy" @click="action('pause')">暂停批次</el-button>
      <el-button v-else-if="batch" :disabled="busy" @click="action('resume')">继续未完成项 / 重试失败步骤</el-button>
    </div>
    <div class="actions">
      <el-select v-model="selected" placeholder="查询已保存批次" style="width:420px" :disabled="busy || running" @change="selectBatch"><el-option v-for="h in history" :key="h._id" :value="h._id" :label="`${h.updatedAt} · ${h.total}题 · ${statusLabels[h.status] || h.status}`" /></el-select>
      <el-button @click="refreshHistory().catch(error)">刷新历史</el-button>
      <el-button :disabled="busy || running || !runs.length" @click="repairScores">恢复已有评分（不调用模型）</el-button>
      <el-button :disabled="busy || !runs.length" @click="downloadReport">导出完整 Excel</el-button>
      <el-checkbox v-model="paired">仅比较五组共同有效题目</el-checkbox>
    </div>
    <el-alert v-if="batch" :closable="false" :title="`${statusLabels[batch.status]} · 已处理 ${batch.queries.length-batch.pending.length}/${batch.queries.length} · 失败待续测 ${batch.failures.length}`" :description="batch.lastError || '结果由服务器持续保存；关闭页面不会取消任务。服务中断后可从历史批次续测。'" />
    <p class="muted">继续未完成题目或重试失败步骤，可能消耗Token。已有回答复用；补检索失败从已保存步骤继续，每题最多3次尝试。已完成补检索但仍缺证据的题目不会反复检索，低分不会自动重评。新增统一证据时重新评审该题各组；旧评分版本升级会归档原评分。新批次使用focused-evidence-v3；旧批次保留原生成策略和所选模型。</p>
    <el-alert title="所有指标有效题数必须达到计划题数的80%才通过验收。20题至少16题，100题至少80题。未达标仍展示实际分数，标注样本不足、仅供参考；无有效评分时才显示“—”。" type="warning" :closable="false" />
    <details class="rules"><summary>指标定义与汇总口径（0–100）</summary>
      <p>Accuracy：已知任一事实错误、要点未完整覆盖或工况不满足即为0，即使其他项未知也能判未达标。无明确失败但仍存在未知则留空。事实全正确、必要要点全覆盖、工况全部满足时，单题为100，否则为0；汇总为整题达标率。不是使用TN计算的分类准确率。</p>
      <p>Precision：v2：正确且有证据支持的事实数 ÷ 可判定事实数；未知事实不判错，请结合逐题可核验率解读。Recall：完整覆盖计1、部分覆盖计0.5、遗漏计0，求和除以必要要点数。F1：每题计算2PR/(P+R)，再等权平均。</p>
      <p>无事实回答的Precision为0；无法核验、无共同标准、生成失败或截断保留空值。默认按各组有效题汇总，样本可能不同；勾选共同题目后若n=0则无可比样本，不代表零分。各指标显示有效样本数n，不把缺失按零分。标准仅基于共同文档、图谱及专家规范；证据池不完整可能影响结果。Token仅计已返回的用量。</p>
    </details>
    <section v-for="config in report" :key="config.key" class="report">
      <h3>{{ config.label }}</h3>
      <p class="muted">v3使用独立事实及明确验收条件；错数值、单位或体系不算部分覆盖。满分仍允许。以下配对分析仅比较同一题的有效F1，显示方向与幅度，不代表统计显著性。</p>
      <el-table :data="config.comparisons" size="small"><el-table-column prop="label" label="相对B文档组"/><el-table-column prop="n" label="共同有效题"/><el-table-column label="F1差值（分）"><template #default="{row}">{{ row.delta === null ? '—' : (row.delta*100).toFixed(2) }}</template></el-table-column><el-table-column prop="win" label="提升"/><el-table-column prop="tie" label="持平"/><el-table-column prop="loss" label="下降"/></el-table>
      <div class="charts">
        <div v-for="(label,m) in metrics" :key="m" class="chart"><h4>{{ label }}</h4><div class="scale"><span>0</span><span>50</span><span>100</span></div>
          <div v-for="(r,i) in config.rows" :key="r.key" class="bar-row"><span class="group-label">{{ r.label }}</span><div class="track"><div class="bar" :style="{width:`${(r[m].value || 0)*100}%`,background:colors[i]}" /></div><span>{{ format(r[m].value) }}<small v-if="!r[m].accepted" class="failure"> 样本不足·仅供参考</small><small> {{ r[m].n }}/{{ r[m].total }} · {{ format(r[m].coverage) }}%</small></span></div>
        </div>
      </div>
      <el-table :data="config.rows" border>
        <el-table-column prop="label" label="实验组" min-width="220" />
        <el-table-column v-for="(label,m) in metrics" :key="m" :label="label" min-width="160"><template #default="{row}">{{ format(row[m].value) }} <small>{{ row[m].n }}/{{ row[m].total }} · {{ format(row[m].coverage) }}% · 满分 {{ row[m].full }} 题</small></template></el-table-column>
        <el-table-column label="检索＋生成均耗时 ms" min-width="170"><template #default="{row}">{{ row.time ?? '—' }}</template></el-table-column>
        <el-table-column label="生成Token" min-width="160"><template #default="{row}">{{ row.known }}{{ row.missing ? `（${row.missing}次用量未知）` : '' }}</template></el-table-column>
      </el-table>
      <p class="muted">共享标准与集中评审 Token：{{ config.shared.known }}{{ config.shared.missing ? `（${config.shared.missing}次用量未知）` : '' }}；只计算一次，不重复分摊到五组。</p>
    </section>
    <h3 v-if="runs.length">逐知识库、逐题分析</h3>
    <section v-for="r in visible" :key="r._id" class="question">
      <h4>{{ r.knowledgeBase?.name || r.knowledgeId || '默认知识库' }} · {{ r.query }}</h4>
      <p v-if="r.factualFollowup" class="muted">自动补救：{{ r.factualFollowup.status }} · 新增评审证据 {{ r.factualFollowup.addedSources ?? 0 }} 条 · {{ r.factualFollowup.error || r.factualFollowup.reason }}</p>
      <p v-if="r.progress" class="muted">执行阶段：{{ r.progress.stage }}</p><p v-if="r.lastError" class="failure">{{ r.lastError }}</p>
      <el-table :data="Object.entries(groups).map(([key,label])=>({key,label}))">
        <el-table-column label="事实可核验率" min-width="130"><template #default="{row}">{{ format(r.variants?.[row.key]?.judge?.verificationCoverage) }}</template></el-table-column>
        <el-table-column prop="label" label="组别" min-width="210" /><el-table-column label="状态" min-width="200"><template #default="{row}">{{ rowStatus(r,row.key) }}</template></el-table-column>
        <el-table-column v-for="(label,m) in metrics" :key="m" :label="label" min-width="155"><template #default="{row}">{{ format(metricValue(r,row.key,m)) }}</template></el-table-column>
      </el-table><el-button text type="primary" :disabled="r.pendingRecord" @click="show(r)">查看五组回答、共同标准和判定依据</el-button>
    </section>
    <el-pagination v-if="runs.length>10" v-model:current-page="page" :page-size="10" :total="runs.length" layout="prev,pager,next,total" />
    <el-dialog :model-value="!!detail" title="原始回答与评审证据" width="85%" @close="detail=null">
      <template v-if="detail"><h4>{{ detail.query }}</h4><h4>共同参考标准（自动生成）</h4><pre>{{ JSON.stringify(detail.rubric,null,2) }}</pre>
        <el-tabs><el-tab-pane v-for="(label,g) in groups" :key="g" :label="label"><h4>回答</h4><pre>{{ detail.variants?.[g]?.answer || '尚未生成' }}</pre><h4>逐事实、要点和工况判定</h4><pre>{{ JSON.stringify(detail.variants?.[g]?.judge,null,2) || detail.variants?.[g]?.error || '尚未评审' }}</pre></el-tab-pane></el-tabs>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.factual{color:#243652}.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:16px 0}.muted,small{color:#728097;font-size:12px;line-height:1.8}.rules{padding:16px;background:#fff;border:1px solid #e3e8f0;margin:16px 0}.rules p{line-height:1.8}.report,.question{border:1px solid #e3e8f0;border-radius:10px;padding:20px;margin:20px 0;background:#fff}.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:24px 0}.chart{background:#fff;border:1px solid #edf0f5;border-radius:8px;padding:16px}.bar-row{display:grid;grid-template-columns:160px 1fr 90px;gap:8px;align-items:center;margin:16px 0;font-size:12px}.track{height:10px;background:#f3f5f8;border-radius:2px}.bar{height:100%;border-radius:2px}.scale{display:flex;justify-content:space-between;margin:0 98px 0 168px;color:#8390a1;font-size:11px}.failure{color:#d44848}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:480px;overflow:auto;background:#fff;padding:12px;line-height:1.7}@media(max-width:1100px){.charts{grid-template-columns:1fr}}
</style>
