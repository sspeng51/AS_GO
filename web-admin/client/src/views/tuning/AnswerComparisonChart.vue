<script setup>
import { computed, ref } from 'vue'
import { chartDomain } from './answerChartScale.mjs'
import { answerMetrics, metricFormat } from './answerMetrics.mjs'
const props = defineProps({ rows: { type: Array, default: () => [] }, metric: String, title: String, questions: { type: Array, default: () => [] } })
const root = ref(null), hidden = ref([]), hover = ref(null), separate = ref(false), zoom = ref(true)
const colors = ['#4263eb', '#0b9d87', '#ed9a22', '#8854d0', '#e35677']
const overview = computed(() => props.metric === 'overview' && !props.questions.length)
const quality = computed(() => overview.value || !!answerMetrics[props.metric])
const labels = computed(() => props.questions.length ? props.questions.map((q,i) => `Q${i+1}`) : overview.value ? Object.values(answerMetrics) : ['A 直接回答', 'B 文档', 'C 文档＋图谱', 'D 文档＋规范', 'E 文档＋图谱＋规范'])
const panels = computed(() => {
  const cohorts = new Map()
  for (const row of props.rows) {
    if (!cohorts.has(row.cohort)) cohorts.set(row.cohort, [])
    cohorts.get(row.cohort).push(row)
  }
  return [...cohorts.values()].map(rows => {
    const series = (overview.value || props.questions.length) ? rows.map((row, i) => ({ name: row.label, color: colors[i], key: row.group,
      points: props.questions.length ? row.questionMetrics.map(metrics => ({ value: metrics[props.metric]?.value ?? null, samples: Number.isFinite(metrics[props.metric]?.value) ? 1 : 0 })) : Object.keys(answerMetrics).map(key => ({ value: row.metrics[key].value, samples: row.metrics[key].samples }))
    })) : [{ name: props.title, color: colors[0], key: 'metric', points: rows.map(row => ({ value: quality.value ? row.metrics[props.metric].value : row[props.metric], samples: quality.value ? row.metrics[props.metric].samples : null })) }]
    const values = series.flatMap(s => s.points.map(p => p.value)).filter(Number.isFinite)
    return { series, config: rows[0]?.configLabel, label: rows[0]?.knowledgeLabel, version: rows[0]?.scoringVersion, ...chartDomain(values, quality.value, zoom.value), hasData: values.length > 0 }
  })
})
const x = i => 100 + i * 820 / Math.max(1, labels.value.length - 1)
const displayPanels = computed(() => separate.value ? panels.value.flatMap(panel => panel.series.map(series => ({ ...panel, series: [series] }))) : panels.value)
const y = (value, panel) => 365 - (value - panel.min) / (panel.max - panel.min) * 245
const tickValue = (tick, panel) => panel.min + tick / 4 * (panel.max - panel.min)
function path(points, panel) {
  let connected = false
  return points.map((point, i) => {
    if (!Number.isFinite(point.value)) { connected = false; return '' }
    const command = connected ? 'L' : 'M'; connected = true
    return `${command}${x(i)},${y(point.value, panel)}`
  }).join(' ')
}
const format = (value, version) => !Number.isFinite(value) ? '无有效样本' : overview.value ? `${(value * 100).toFixed(0)}` : quality.value ? metricFormat(value, props.metric, version) : value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
const tooltipFormat = (point, i, version) => quality.value ? metricFormat(point?.value, overview.value ? Object.keys(answerMetrics)[i] : props.metric, version) : format(point?.value, version)
function toggle(key) { hidden.value = hidden.value.includes(key) ? hidden.value.filter(k => k !== key) : [...hidden.value, key] }
async function exportPNG() {
  const svgs = [...root.value.querySelectorAll('svg')]
  const canvas = document.createElement('canvas'); canvas.width = 2080; canvas.height = svgs.length * 940
  const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < svgs.length; i++) {
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svgs[i])], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url })
      context.drawImage(image, 0, i * 940, 2080, 940)
    } finally { URL.revokeObjectURL(url) }
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve)); if (!blob) throw new Error('图表导出失败'); return blob
}
defineExpose({ exportPNG })
</script>
<template>
  <div ref="root" class="line-charts">
    <el-switch v-if="overview || questions.length" v-model="separate" active-text="五组分别展开" inactive-text="叠加对比" @change="hover = null; hidden = []" />
    <el-switch v-model="zoom" active-text="自动缩放Y轴" inactive-text="完整Y轴" style="margin-left:24px" @change="hover = null" />
    <div v-for="(panel, pi) in displayPanels" :key="pi" class="line-panel">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 470" role="img" :aria-label="`${title}折线图，对比配置${pi + 1}`" style="width:100%;font-family:Arial,'Microsoft YaHei',sans-serif" @mouseleave="hover = null">
        <rect width="1040" height="470" fill="#ffffff" />
        <text x="34" y="36" font-size="19" font-weight="700" fill="#20314d">{{ title }}</text>
        <text x="34" y="56" font-size="10" fill="#77859a">{{ panel.label?.slice(0, 55) }} · {{ panel.config }} · {{ panel.version === 'analytic-100-v2' ? '百分制分析标准v2' : panel.version === 'anchored-v1' ? '分级标准v1' : '旧版二值标准' }}</text>
        <g v-for="(series, si) in panel.series" :key="series.key" :opacity="hidden.includes(series.key) ? 0.3 : 1" style="cursor:pointer" role="button" tabindex="0" :aria-label="`显示或隐藏${series.name}`" @click="toggle(series.key)" @keydown.enter="toggle(series.key)" @keydown.space.prevent="toggle(series.key)">
          <circle :cx="40 + si * 198" cy="84" r="5" :fill="series.color" />
          <text :x="52 + si * 198" y="89" font-size="12" fill="#485b75">{{ series.name }}</text>
        </g>
        <text x="920" y="108" text-anchor="end" font-size="11" fill="#64748b">{{ zoom ? 'Y轴缩放' : '完整Y轴' }}：{{ format(panel.min, panel.version) }} – {{ format(panel.max, panel.version) }}{{ panel.min > 0 ? '（非零起点）' : '' }}</text>
        <path v-if="panel.min > 0" d="M89,366l7,-5l-7,-5l7,-5" fill="none" stroke="#64748b" stroke-width="1.5" />
        <g v-for="tick in [0, 1, 2, 3, 4]" :key="tick">
          <line x1="100" x2="920" :y1="y(tickValue(tick, panel), panel)" :y2="y(tickValue(tick, panel), panel)" stroke="#e1e8f3" stroke-dasharray="4 5" />
          <text x="83" :y="y(tickValue(tick, panel), panel) + 4" text-anchor="end" font-size="11" fill="#8795aa">{{ format(tickValue(tick, panel), panel.version) }}</text>
        </g>
        <text v-for="(label, i) in labels" :key="label" :x="x(i)" y="397" text-anchor="middle" font-size="12" fill="#52647f">{{ label }}</text>
        <template v-for="(series, si) in panel.series" :key="series.key">
          <g v-if="!hidden.includes(series.key)">
            <path :d="path(series.points, panel)" fill="none" :stroke="series.color" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
            <template v-for="(point, i) in series.points" :key="i">
              <g v-if="Number.isFinite(point.value)">
                <path v-if="!Number.isFinite(series.points[i - 1]?.value) && !Number.isFinite(series.points[i + 1]?.value)" :d="`M${x(i) - 3},${y(point.value, panel)}h6`" :stroke="series.color" stroke-width="3" />
                <circle :cx="x(i)" :cy="y(point.value, panel)" r="13" fill="transparent" tabindex="0" :aria-label="`${series.name} ${labels[i]} ${tooltipFormat(point, i, panel.version)} n=${point.samples ?? '不适用'}`" @mouseenter="hover = { pi, i, series, point }" @focus="hover = { pi, i, series, point }" @blur="hover = null">
                  <title>{{ series.name }} · {{ labels[i] }}：{{ tooltipFormat(point, i, panel.version) }}{{ point.samples !== null ? ` · n=${point.samples}` : '' }}</title>
                </circle>
              </g>
            </template>
          </g>
        </template>
        <g v-if="hover?.pi === pi" pointer-events="none" :transform="`translate(${Math.min(x(hover.i), 660)},${Math.max(90, y(hover.point.value, panel) - 150)})`">
          <rect width="345" :height="35 + panel.series.length * 23" rx="9" fill="#20314d" opacity="0.97" />
          <text x="14" y="22" fill="white" font-size="12">{{ labels[hover.i] }} · {{ questions.length ? '逐题结果' : '各组原始指标' }}</text>
          <text v-for="(s, index) in panel.series" :key="s.key" x="14" :y="45 + index * 23" :fill="s.color" font-size="12">{{ s.name }}：{{ tooltipFormat(s.points[hover.i], hover.i, panel.version) }} · n={{ s.points[hover.i].samples ?? '—' }}</text>
        </g>
        <text v-if="!panel.hasData" x="520" y="230" text-anchor="middle" fill="#8190a7" font-size="15">等待有效结果 · 完成后自动更新</text>
        <text x="34" y="445" font-size="11" fill="#8490a4">{{ overview ? (panel.version === 'analytic-100-v2' ? '纵轴为百分制分数；悬停查看分项得分。' : '旧标准：纵轴为0–100归一化位置；悬停查看原始分数/比例。') : '' }}五项指标均为越高越好；同值可能重叠，可分别展开；缺失值断线。</text>
      </svg>
    </div>
  </div>
</template>
<style scoped>
.line-charts { background:#ffffff; }
.line-panel { margin:18px 0; overflow-x:auto; border:1px solid #e5ecf7; border-radius:20px; background:#ffffff; }
svg { display:block; min-width:720px; background:#ffffff; }
</style>
