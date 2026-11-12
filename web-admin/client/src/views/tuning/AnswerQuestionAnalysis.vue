<script setup>
import { computed, ref, watch } from 'vue'
import { answerMetrics, answerGroups, questionAnalysis, metricFormat, metricFor } from './answerMetrics.mjs'
import AnswerComparisonChart from './AnswerComparisonChart.vue'
const props = defineProps({ runs: { type: Array, default: () => [] } })
const groups = computed(() => questionAnalysis(props.runs))
const selected = ref(''), metric = ref('professionalCorrectness'), page = ref(1)
const current = computed(() => groups.value.find(group => group.cohort === selected.value) || groups.value[0])
const questions = computed(() => (current.value?.questions || []).slice((page.value - 1) * 10, page.value * 10))
const chartRows = computed(() => current.value?.rows.map(row => ({ ...row, questionMetrics: row.questionMetrics.slice((page.value - 1) * 10, page.value * 10) })) || [])
watch(selected, () => { page.value = 1 })
</script>
<template>
  <el-card v-if="current" shadow="never" class="question-analysis">
    <h3>知识库逐题分析</h3>
    <div class="controls">
      <el-select v-model="selected" :placeholder="current.label" style="width:420px"><el-option v-for="(group,i) in groups" :key="group.cohort" :label="`${group.label} · ${group.configLabel} · 配置${i+1} · ${group.version === 'analytic-100-v2' ? '百分制分析标准v2' : group.version === 'anchored-v1' ? '分级标准' : '旧版标准'}`" :value="group.cohort" /></el-select>
      <el-select v-model="metric" style="width:210px"><el-option v-for="(name,key) in answerMetrics" :key="key" :label="name" :value="key" /></el-select>
    </div>
    <p class="hint">按知识库、模型与评分版本分别展示每题五组指标；缺失评分不计为零。</p>
    <el-pagination v-model:current-page="page" :page-size="10" :total="current.questions.length" layout="prev, pager, next, total" />
    <AnswerComparisonChart :rows="chartRows" :questions="questions" :metric="metric" :title="`${answerMetrics[metric]} · 逐题趋势（本页）`" />
    <el-table :data="questions">
      <el-table-column label="问题" min-width="260"><template #default="{row,$index}">Q{{ $index+1 }} · {{ row.query }}</template></el-table-column>
      <el-table-column v-for="(label,key) in answerGroups" :key="key" :label="label" min-width="140"><template #default="{row}">{{ metricFormat(row.variants[key]?.finishReason === 'length' ? null : metricFor(row.variants[key], metric)?.value, metric, current.version) }}</template></el-table-column>
    </el-table>
  </el-card>
</template>
<style scoped>
.question-analysis { margin:20px 0; } .controls { display:flex; gap:12px; flex-wrap:wrap; margin:16px 0; } .hint { color:#748095; line-height:1.8; font-size:13px; } .el-pagination { margin-top:16px; }
</style>
