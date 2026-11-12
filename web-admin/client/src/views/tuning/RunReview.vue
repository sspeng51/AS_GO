<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { quickMetrics } from './quickMetrics.mjs'
import { useAuthStore } from '@/stores/auth'
const props = defineProps({ run: { type: Object, required: true }, locked: Boolean })
const emit = defineEmits(['update', 'gold', 'busy'])
const auth = useAuthStore()
const busy = ref('')
watch(busy, value => emit('busy', value))
const grades = ref({})
const covered = ref([])
const coverageReviewed = ref(false)
const note = ref('')
watch(() => props.run, run => {
  grades.value = { ...(run.review?.grades || {}) }
  covered.value = [...(run.review?.coveredPoints || [])]
  coverageReviewed.value = Array.isArray(run.review?.coveredPoints)
  note.value = run.review?.note || ''
}, { immediate: true })
const metrics = computed(() => props.run.metrics || {})
const displayedMetrics = computed(() => quickMetrics(props.run))
const labels = { precisionAtK: 'Precision@K', recallAtK: 'Recall@K', mrr: 'MRR', hitRate: 'Hit Rate', contextRelevance: '上下文相关性', ndcgAtK: 'nDCG@K', evidenceCoverage: '证据覆盖率', noAnswerCorrect: '无答案判断正确', falseRecall: '无答案误召回' }
const percent = value => Number.isFinite(value) ? `${(value*100).toFixed(1)}分` : '待评估'
function suggestion(id) { return props.run.judge?.grades?.find(item => item.id === id) }
async function judge() {
  busy.value = 'judge'
  try {
    let { data } = await api.post(`/rag-tuning/runs/${props.run._id}/judge`, { autoEvidencePoints: true, autoReferencePool: true }, { timeout: 360000 })
    if (!data.run) data = (await api.get(`/rag-tuning/runs/${props.run._id}`)).data
    emit('update', { ...props.run, ...data.run, autoError: '' })
    ElMessage.success('模型评估完成，指标已更新')
  } catch (error) { ElMessage.error(error.response?.data?.error || error.message) }
  finally { busy.value = '' }
}
function adopt() {
  grades.value = Object.fromEntries(props.run.judge.grades.map(item => [item.id, item.grade]))
  covered.value = props.run.judge.coverage.map(item => item.point)
  coverageReviewed.value = true
  ElMessage.info('已填入初评建议，请核对后保存人工复核')
}
async function saveReview() {
  busy.value = 'review'
  try {
    const { data } = await api.put(`/rag-tuning/runs/${props.run._id}/review`, { grades: grades.value, coveredPoints: coverageReviewed.value ? covered.value : null, note: note.value, judgeId: props.run.judge?.id || null })
    emit('update', data.run)
    ElMessage.success('人工复核已保存，指标已重算')
  } catch (error) { ElMessage.error(error.response?.data?.error || error.message) }
  finally { busy.value = '' }
}
</script>

<template>
  <section class="run-review">
    <p class="muted">检索模式：<b>{{ { knowledge: '仅知识库', graph: '仅知识图谱', hybrid: '混合检索' }[run.retrievalMode || 'hybrid'] }}</b><template v-if="run.retrievalMode !== 'graph'"> · 知识库：{{ run.knowledgeBase?.name || '名称未获取' }} · ID：{{ run.knowledgeBase?.id || run.requestedKnowledgeId || '默认库（ID 未核验）' }}</template></p>
    <el-alert v-if="run.standardWarning" :title="run.standardWarning" type="warning" :closable="false" />
    <el-alert v-if="run.error" :title="'检索失败：' + run.error" type="error" :closable="false" />
    <el-alert v-else-if="metrics.warning" :title="metrics.warning" :type="metrics.eligible ? 'info' : 'warning'" :closable="false" />
    <el-alert v-if="run.configWarning" :title="run.configWarning" type="warning" :closable="false" />
    <div class="metric-grid">
      <div class="metric"><small>检索耗时</small><strong>{{ run.latencyMs }} ms</strong></div>
      <div class="metric"><small>前 {{ run.k }} 条 / 实际返回</small><strong>{{ run.results.length }} 条</strong></div>
      <div v-for="(label, key) in labels" :key="key" class="metric"><small>{{ label }}</small><strong>{{ typeof displayedMetrics[key].value === 'number' ? percent(displayedMetrics[key].value, key) : '—' }}</strong><small>{{ displayedMetrics[key].basis }}</small></div>
      <div class="metric"><small>检索费用</small><strong>暂不可得</strong></div>
    </div>
    <p class="muted">评估当前所选检索范围内的前 K 条证据。仅知识库时不包含图谱；混合模式为文档在前、图谱在后。Precision 分母为 K；Recall/nDCG 需要完整标准资料；模型初评不计入正式指标。</p>
    <el-collapse>
      <el-collapse-item v-if="run.judge?.referencePool" :title="`LLM 候选池参考标准（${run.judge.referencePool.size} 条，非完整金标准）`" name="referencePool">
        <p>仅对本次可见候选资料评分，用于候选池 Recall / NDCG 估算。未发现的相关资料不在分母中，不能视为全库召回率。</p>
        <el-table :data="run.judge.referencePool.grades"><el-table-column prop="id" label="资料 ID" min-width="200" /><el-table-column prop="grade" label="相关等级" width="100" /><el-table-column prop="relevanceScore" label="相关性 / 100分" width="130" /><el-table-column prop="reason" label="理由" min-width="180" /><el-table-column prop="quote" label="原文依据" min-width="220" /></el-table>
      </el-collapse-item>
      <el-collapse-item title="实际配置、来源诊断与生成上下文" name="trace">
        <p>上下文字符数：{{ run.context?.length || 0 }}。生成测试使用下方完整上下文，可能包含前 K 条之外的图谱证据。</p>
        <pre>{{ JSON.stringify({ effectiveConfig: run.effectiveConfig, sourceInfo: run.sourceInfo }, null, 2) }}</pre>
        <pre>{{ run.context || '无上下文' }}</pre>
      </el-collapse-item>
      <el-collapse-item v-if="run.candidates?.length" :title="`知识库候选结果（阈值与上下文筛选前，共 ${run.candidates.length} 条）`" name="candidates">
        <div v-for="item in run.candidates" :key="item.evaluationId" class="candidate"><b>{{ item.title }} · {{ item.score }}</b><pre>{{ item.content }}</pre></div>
      </el-collapse-item>
    </el-collapse>
    <div class="toolbar">
      <h3>证据与复核</h3>
      <el-button type="primary" :disabled="!auth.isAdmin || locked || !!busy || !metrics.eligible || !run.results.length" :loading="busy === 'judge'" @click="judge">{{ run.judge ? '重新调用模型评估' : '调用模型评估指标' }}</el-button>
      <el-button v-if="run.judge" :disabled="!auth.isAdmin || locked || !!busy" @click="adopt">填入初评建议</el-button>
    </div>
    <el-alert v-if="run.judge" :title="`模型初评 · ${run.judge.model}：${run.judge.sufficiency}${run.judge.truncated ? `（部分资料截断至前 ${run.judge.contentLimit || 3000} 字）` : ''}`" type="info" :closable="false" />
    <p v-if="run.judge?.modelCalls" class="muted">本次评估调用模型 {{ run.judge.modelCalls }} 次 · 总耗时 {{ ((run.judge.latencyMs || 0) / 1000).toFixed(1) }} 秒 · Token {{ run.judge.usage?.total_tokens ?? '上游未提供' }}</p>
    <el-empty v-if="!run.results.length" description="没有返回证据；若为故障，请修复后重跑。" :image-size="70" />
    <article v-for="(item, index) in run.results" :key="item.evaluationId" class="evidence">
      <div class="evidence-title"><b>{{ index + 1 }}. {{ item.title }}</b><el-tag size="small" effect="plain">{{ item.sourceType === 'neo4j' ? '知识图谱' : '知识库' }}</el-tag></div>
      <div class="muted">资料 ID：<code>{{ item.evaluationId }}</code> · 检索分数 {{ item.score ?? '不适用' }}</div>
      <pre>{{ item.content }}</pre>
      <div v-if="suggestion(item.evaluationId)" class="suggestion">模型建议：等级 {{ suggestion(item.evaluationId).grade }}<span v-if="Number.isFinite(suggestion(item.evaluationId).relevanceScore)"> · 相关性 {{ suggestion(item.evaluationId).relevanceScore }} / 100分</span> · {{ suggestion(item.evaluationId).reason }}<br><span v-if="suggestion(item.evaluationId).breakdown">直接支持 {{ suggestion(item.evaluationId).breakdown.directness }}/50 · 工况范围 {{ suggestion(item.evaluationId).breakdown.scope }}/30 · 细节 {{ suggestion(item.evaluationId).breakdown.detail }}/20<br></span>依据：{{ suggestion(item.evaluationId).quote || '无相关依据' }}</div>
      <el-radio-group v-model="grades[item.evaluationId]" :disabled="!auth.isAdmin || locked || !!busy" size="small">
        <el-radio-button :value="0">无关 · 0</el-radio-button><el-radio-button :value="1">背景相关 · 1</el-radio-button><el-radio-button :value="2">直接支撑 · 2</el-radio-button>
      </el-radio-group>
      <el-button text size="small" :disabled="!auth.isAdmin || locked || !!busy" @click="delete grades[item.evaluationId]">清除人工标注</el-button>
    </article>
    <div v-if="run.testCase?.evidencePoints?.length" class="coverage">
      <h4>所需证据点</h4><el-checkbox v-model="coverageReviewed" :disabled="!auth.isAdmin || locked">已人工检查证据覆盖（未勾选则不计分）</el-checkbox>
      <el-checkbox-group v-model="covered" :disabled="!auth.isAdmin || locked || !coverageReviewed">
        <div v-for="(point, index) in run.testCase.evidencePoints" :key="index"><el-checkbox :value="index">{{ point }}</el-checkbox></div>
      </el-checkbox-group>
    </div>
    <el-input v-model="note" type="textarea" :rows="2" maxlength="2000" :disabled="!auth.isAdmin || locked" placeholder="复核意见 / 失败原因：未收录、漏召回、排序靠后、证据不足等" />
    <div class="toolbar">
      <el-button type="primary" :disabled="!auth.isAdmin || locked || !!busy" :loading="busy === 'review'" @click="saveReview">保存人工复核</el-button>
      <el-button :disabled="!auth.isAdmin || locked || !!busy || !Object.keys(grades).length" @click="emit('gold', { run, grades })">用标注完善测试标准</el-button>
      <span class="muted" v-if="run.review">最近复核：{{ run.review.reviewer }} · {{ run.review.reviewedAt }}</span>
    </div>
  </section>
</template>

<style scoped>
.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 10px; margin: 16px 0; }
.metric { background: #f4f7fb; border-radius: 8px; padding: 14px; }
.metric small { color: #738097; display: block; margin-bottom: 10px; }
.metric strong { font-size: 18px; color: #233a59; }
.muted { color: #778498; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.toolbar, .evidence-title { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 16px 0; }
.toolbar h3 { flex: 1; margin: 0; }
.evidence { border: 1px solid #e4eaf2; padding: 16px; border-radius: 8px; margin: 14px 0; }
.evidence-title { margin: 0 0 10px; justify-content: space-between; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 13px; line-height: 1.8; max-height: 360px; overflow: auto; }
.suggestion { padding: 10px; background: #eff5ff; color: #456185; font-size: 13px; line-height: 1.8; margin-bottom: 14px; }
.coverage { margin: 20px 0; }
.coverage :deep(.el-checkbox) { height: auto; min-height: 32px; }
.coverage :deep(.el-checkbox__label) { white-space: normal; }
.candidate { border-bottom: 1px solid #e4eaf2; }
</style>
