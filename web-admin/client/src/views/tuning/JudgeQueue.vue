<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
const props = defineProps({ active: Boolean, batchId: String, locked: Boolean })
const emit = defineEmits(['open', 'busy'])
const auth = useAuthStore()
const rows = ref([]), selected = ref([]), table = ref(null), loading = ref(false)
const status = ref('all'), knowledge = ref(''), currentBatch = ref(false), progress = ref(null), running = ref(false)
let stopped = false
const labels = { unjudged: '未初评', pending: '待抽查', reviewed: '已复核', failed: '初评失败', running: '初评中', blocked: '检索异常', empty: '空结果待确认' }
const filtered = computed(() => rows.value.filter(row => (!knowledge.value || row.knowledgeId === knowledge.value) && (!currentBatch.value || row.batchId === props.batchId) && (status.value === 'all' || status.value === 'priority' ? status.value === 'all' || row.priority : row.status === status.value)))
const knowledgeIds = computed(() => [...new Set(rows.value.map(row => row.knowledgeId).filter(Boolean))])
const candidates = computed(() => selected.value.filter(row => row.canJudge && (!row.hasJudge || row.status === 'failed')))
const failures = computed(() => filtered.value.filter(row => row.status === 'failed' && row.canJudge))
const percent = value => value === null ? '—' : `${Math.round(value * 100)}%`
const fail = error => ElMessage.error(error.response?.data?.error || error.message)
async function refresh() {
  loading.value = true
  try { rows.value = (await api.get('/rag-tuning/review-queue')).data.rows }
  catch (error) { fail(error) }
  finally { loading.value = false }
}
watch(() => props.active, value => { if (value) refresh(); else stopped = true }, { immediate: true })
watch(() => props.batchId, value => { if (value) { currentBatch.value = true; status.value = 'all' } })
onBeforeUnmount(() => { stopped = true })
async function start(items) {
  if (running.value || !items.length) return
  stopped = false; running.value = true; emit('busy', 'batch-judge')
  progress.value = { done: 0, total: items.length, failed: 0 }
  try {
    for (const row of [...items]) {
      if (stopped) break
      const started = Date.now()
      try { await api.post(`/rag-tuning/runs/${row._id}/judge`, { skipExisting: true, autoEvidencePoints: true }, { timeout: 360000 }) }
      catch (error) { progress.value.failed++; fail(error); if ([401, 403, 429].includes(error.response?.status)) stopped = true }
      progress.value.done++
      if (!stopped && progress.value.done < progress.value.total) await new Promise(resolve => setTimeout(resolve, Math.max(0, 2100 - (Date.now() - started))))
    }
  } finally { running.value = false; emit('busy', ''); await refresh() }
}
async function sample() {
  const pool = filtered.value.filter(row => row.status === 'pending')
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
  await nextTick(); table.value.clearSelection()
  pool.slice(0, Math.ceil(pool.length * 0.2)).forEach(row => table.value.toggleRowSelection(row, true))
  ElMessage.success(`已随机选中 ${Math.ceil(pool.length * 0.2)} 条待抽查记录，请逐条打开复核`)
}
</script>

<template>
  <div v-loading="loading">
    <el-alert title="模型初评单独展示，不写入正式质量指标。人工只需优先检查异常项，再随机抽查其余结果；打开记录、核对证据并保存标注后记为已复核。" type="info" :closable="false" />
    <p class="muted">展示最近 100 条检索记录。初评分为召回资料相关等级均值 ÷ 2，不代表召回率。批量初评逐条调用模型；离开此页后在当前请求结束时停止，已完成结果和失败状态会保存。</p>
    <div class="toolbar">
      <el-select v-model="status" style="width: 160px" :disabled="running"><el-option label="全部状态" value="all" /><el-option label="优先抽查" value="priority" /><el-option v-for="(label, value) in labels" :key="value" :label="label" :value="value" /></el-select>
      <el-select v-model="knowledge" clearable placeholder="全部知识库" style="width: 260px" :disabled="running"><el-option v-for="id in knowledgeIds" :key="id" :label="id" :value="id" /></el-select>
      <el-checkbox v-if="batchId" v-model="currentBatch" :disabled="running">仅本次检索批次</el-checkbox>
      <el-button :disabled="locked || running" @click="refresh">刷新</el-button>
    </div>
    <div class="toolbar">
      <el-button type="primary" :disabled="!auth.isAdmin || locked || !candidates.length" @click="start(candidates)">批量模型初评（{{ candidates.length }}）</el-button>
      <el-button :disabled="!auth.isAdmin || locked || !failures.length" @click="start(failures)">重试筛选内失败项（{{ failures.length }}）</el-button>
      <el-button :disabled="locked || !filtered.some(row => row.status === 'pending')" @click="sample">随机抽查 20%</el-button>
      <el-button v-if="running" @click="stopped = true">当前题结束后停止</el-button>
    </div>
    <div v-if="progress" class="progress"><el-progress :percentage="Math.round(progress.done / progress.total * 100)" />{{ progress.done }}/{{ progress.total }} · 失败 {{ progress.failed }} · {{ running ? '初评中' : progress.done < progress.total ? '已停止，可选择未完成记录继续' : '已完成' }}</div>
    <el-table ref="table" :data="filtered" row-key="_id" @selection-change="value => selected = value" empty-text="暂无匹配记录，请先运行知识库检索">
      <el-table-column type="selection" width="45" :selectable="() => !locked" />
      <el-table-column prop="query" label="问题" min-width="190" />
      <el-table-column prop="knowledgeId" label="知识库 ID" min-width="150" />
      <el-table-column label="状态" width="130"><template #default="{ row }"><el-tag :type="row.status === 'reviewed' ? 'success' : row.priority ? 'warning' : 'info'">{{ labels[row.status] }}</el-tag></template></el-table-column>
      <el-table-column label="模型初评分" width="110"><template #default="{ row }">{{ percent(row.aiScore) }}</template></el-table-column>
      <el-table-column label="模型证据覆盖" width="120"><template #default="{ row }">{{ percent(row.aiEvidenceCoverage) }}</template></el-table-column>
      <el-table-column label="抽查原因 / 诊断" min-width="230"><template #default="{ row }">{{ row.reasons.join('；') || row.metrics.warning || '—' }}<div class="muted">{{ row.attemptError }}</div></template></el-table-column>
      <el-table-column prop="judgeModel" label="初评模型" width="120" />
      <el-table-column label="操作" width="110"><template #default="{ row }"><el-button text :disabled="locked" @click="emit('open', row._id)">{{ row.status === 'blocked' ? '查看诊断' : '打开复核' }}</el-button></template></el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 14px 0; }
.muted { color: #778498; font-size: 12px; line-height: 1.8; }
.progress { padding: 14px; background: #f2f6fc; margin-bottom: 14px; }
</style>
