<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue'
import {ElMessage} from 'element-plus'
import api from '../../api'
import {importCases,template,report,summarizeBatch} from './embeddingBatchIO.mjs'
import {DEFAULT_KNOWLEDGE_ID} from './defaultKnowledge.mjs'
const root='/rag-tuning/answer-tests',mode='embedding-3-cosine-v1'
const cases=ref([]),batch=ref(null),history=ref([]),busy=ref(false),fileInput=ref(null),model=ref('glm-5.3'),models=ref([]),knowledgeId=ref(DEFAULT_KNOWLEDGE_ID),k=ref(5),detail=ref(null)
const running=computed(()=>['queued','running'].includes(batch.value?.status))
const states={queued:'排队中',running:'执行中',paused:'已暂停',interrupted:'已中断，可续跑',completed:'已完成',completed_with_errors:'部分失败，可续跑'}
const rows=computed(()=>(batch.value?.queries||[]).map((query,i)=>({index:i+1,query,run:batch.value.summaries[i],id:batch.value.ids[i],failed:batch.value.failures.includes(i)})))
const summary=computed(()=>summarizeBatch(batch.value))
const completed=computed(()=>batch.value?batch.value.ids.length-batch.value.pending.length:0)
let timer,polling=false
function error(e){ElMessage.error(e.response?.data?.error||e.message)}
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const excel=(data,name)=>download(data,name,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
async function upload(e){try{const file=e.target.files?.[0];if(file)cases.value=await importCases(file)}catch(e){error(e)}finally{e.target.value=''}}
async function refresh(){history.value=(await api.get(`${root}/batches`,{params:{evaluationMode:mode}})).data.batches}
async function load(id){const next=(await api.get(`${root}/batches/${id}`)).data.batch;if(next.settings.evaluationMode!==mode)throw new Error('实验类型不匹配');batch.value=next;localStorage.setItem('embedding-batch',id)}
async function select(id){try{await load(id)}catch(e){error(e)}}
async function start(){busy.value=true;try{const {data}=await api.post(`${root}/batches`,{cases:cases.value,evaluationMode:mode,generation:{model:model.value},knowledgeId:knowledgeId.value,k:k.value});await load(data.batch._id);await refresh()}catch(e){error(e)}finally{busy.value=false}}
async function action(name){busy.value=true;try{await api.post(`${root}/batches/${batch.value._id}/${name}`,{});await load(batch.value._id)}catch(e){error(e)}finally{busy.value=false}}
async function show(id){try{detail.value=(await api.get(`${root}/${id}`)).data.experiment}catch(e){error(e)}}
async function exportFull(){busy.value=true;try{const records=[];for(const row of rows.value){if(row.run)records.push((await api.get(`${root}/${row.id}`)).data.experiment)}download(JSON.stringify({batch:batch.value,records},null,2),'向量实验完整记录.json','application/json')}catch(e){error(e)}finally{busy.value=false}}
function score(row,g){const value=row.run?.embeddingEvaluation?.scores?.[g]?.accuracy;return Number.isFinite(value)?value.toFixed(2)+'%':'—'}
onMounted(async()=>{try{models.value=(await api.get('/rag-tuning/settings')).data.models;await refresh();const id=localStorage.getItem('embedding-batch');if(id)await load(id)}catch(e){error(e)};timer=setInterval(async()=>{if(!running.value||polling)return;polling=true;try{await load(batch.value._id)}catch(e){error(e)}finally{polling=false}},5000)})
onBeforeUnmount(()=>clearInterval(timer))
</script>
<template>
<section>
<h3>批量上传 · 五组向量相似度实验</h3>
<p>上传 XLSX、CSV 或 JSON，不设固定题数上限。每行必须有“问题”和“标准答案”（也可列名“标准答案关键词”）。相同问题的不同标准会保留为不同实验。</p>
<el-button @click="excel(template(),'向量实验上传模板.xlsx')">下载 Excel 模板</el-button>
<el-button :disabled="busy||running" @click="fileInput.click()">上传测试集</el-button>
<input ref="fileInput" type="file" accept=".xlsx,.csv,.json" hidden @change="upload" />
<p v-if="cases.length">已导入 {{cases.length}} 题，共 {{cases.length*5}} 组回答。</p>
<el-table v-if="cases.length" :data="cases" max-height="260"><el-table-column prop="query" label="问题"/><el-table-column prop="reference" label="标准答案 / 关键词"/></el-table>
<el-form label-position="top" :disabled="busy||running">
<el-form-item label="知识库 ID"><el-input v-model="knowledgeId" /></el-form-item>
<el-form-item label="统一生成模型"><el-select v-model="model"><el-option v-for="m in models" :key="m" :label="m" :value="m"/></el-select></el-form-item>
<el-form-item label="检索 K"><el-input-number v-model="k" :min="1" :max="20"/></el-form-item>
</el-form>
<el-button type="primary" :disabled="busy||running||!cases.length" @click="start">开始后台批量处理</el-button>
<p>提交后由后台执行，关闭页面不影响任务。单题失败会记录并跳过，先处理完整批题目，再统一重试失败题。暂停在当前阶段结束后生效；服务重启后可继续，已完成回答和评分不重复调用。</p>
<el-select placeholder="历史批次" :model-value="batch?._id" @change="select"><el-option v-for="h in history" :key="h._id" :value="h._id" :label="`${h.updatedAt} · ${h.total}题`"/></el-select>
<template v-if="batch">
<p>{{states[batch.status]}} · 已处理 {{completed}} / {{batch.ids.length}} 题 · 失败 {{batch.failures.length}} 题</p>
<el-progress :percentage="Math.round(completed/batch.ids.length*100)"/>
<el-button v-if="running" :disabled="busy" @click="action('pause')">当前阶段完成后暂停</el-button><el-button v-else :disabled="busy" @click="action('resume')">{{batch.pending.some(i=>!batch.failures.includes(i))?'继续处理剩余题目':'统一重试失败题'}}</el-button>
<el-button @click="excel(report(batch),'批量向量实验评分.xlsx')">导出评分 Excel</el-button><el-button :disabled="busy" @click="exportFull">导出完整记录 JSON</el-button>
<section class="summary-panel">
<h3>五组综合评分{{batch.status==='completed'?'':'（当前结果）'}}</h3>
<p>各题得分等权平均，仅统计五组均有有效评分的共同题目。共同有效题数：{{summary[0].samples}} / {{summary[0].total}}；缺失、失败或截断不补零。</p>
<div class="score-grid"><article v-for="item in summary" :key="item.group" class="score-card"><h4>{{item.group}}组 · {{item.label}}</h4><strong>{{item.score===null?'—':item.score.toFixed(2)+'%'}}</strong><span>{{item.samples ? '共同有效题目的平均分' : '暂无共同有效评分'}}</span></article></div>
<p>评分使用智谱 embedding-3。单题得分＝答案与标准的余弦相似度 ÷ 标准自身相似度 × 100%；综合评分衡量语义相似程度，不等同事实正确率。</p>
</section>
<h4>批量逐题结果</h4>
<el-table :data="rows" max-height="600"><el-table-column prop="index" label="题号" width="65"/><el-table-column prop="query" label="问题" min-width="220"/>
<el-table-column v-for="g in 'ABCDE'" :key="g" :label="g+'组'" width="100"><template #default="{row}">{{score(row,g)}}</template></el-table-column>
<el-table-column label="状态" min-width="180"><template #default="{row}">{{row.failed?'失败 / 评分不完整':row.run?.embeddingEvaluation?'已评分':row.run?.progress?.stage||'等待处理'}} {{row.run?.lastError||''}}</template></el-table-column>
<el-table-column label="详情"><template #default="{row}"><el-button text :disabled="!row.run" @click="show(row.id)">查看</el-button></template></el-table-column></el-table>
</template>
<el-dialog :model-value="!!detail" title="问题、标准与五组回答" width="85%" @close="detail=null"><template v-if="detail"><h4>{{detail.query}}</h4><p>标准：{{detail.reference}}</p><div v-for="g in 'ABCDE'" :key="g"><h4>{{g}}组 · {{detail.embeddingEvaluation?.scores?.[g]?.accuracy?.toFixed(2)??'—'}}%</h4><pre>{{detail.variants[g]?.answer||'未生成'}}</pre></div></template></el-dialog>
</section>
</template>
<style scoped>p{color:#64748b;line-height:1.7}.el-form{margin-top:18px;max-width:900px}pre{white-space:pre-wrap}.summary-panel{margin-top:24px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px}.score-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.score-card{padding:16px;background:white;border:1px solid #e2e8f0;border-radius:8px}.score-card h4{margin:0 0 18px;font-size:14px;min-height:38px}.score-card strong{display:block;font-size:30px;color:#2563eb}.score-card span{display:block;margin-top:10px;font-size:12px;color:#64748b}</style>
