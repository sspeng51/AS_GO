<script setup>
import {computed,onMounted,onBeforeUnmount,ref} from 'vue'
import api from '@/api'
import {useAuthStore} from '@/stores/auth'
import {importQuestions,templateWorkbook} from './evidenceAutoIO.mjs'
import {workbookBytes} from './answerExport.mjs'
const auth=useAuthStore(),base='/rag-tuning/graph-relevance'
const text=ref(''),model=ref('glm-5.3-flash'),models=ref([]),name=ref(''),batch=ref(null),history=ref([]),selected=ref(''),busy=ref(false),stopped=ref(false),error=ref(''),progress=ref(''),upload=ref(null),detail=ref(null)
let alive=true
const questions=computed(()=>text.value.split(/\r?\n/).map(q=>q.trim()).filter(Boolean))
const rows=computed(()=>batch.value?.questions.map((query,index)=>({query,index,...batch.value.rows.find(r=>r.index===index)}))||[])
const pct=v=>Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'—'
const metricDefs=[['recall9','Recall@9'],['precision9','Precision@9'],['mrr','MRR'],['ndcg9','NDCG@9'],['hit','Hit Rate@9'],['contextRelevance','Context relevance']]
const chartMetric=ref('precision9')
const explain=e=>e.response?.data?.error||e.message
async function guarded(fn){busy.value=true;error.value='';try{await fn()}catch(e){error.value=explain(e)}finally{busy.value=false}}
async function refresh(){const {data}=await api.get(base);history.value=data.batches;models.value=data.models;if(!models.value.includes(model.value))model.value=models.value[0]||''}
async function load(){await guarded(async()=>{batch.value=(await api.get(`${base}/${selected.value}`)).data.batch;detail.value=null})}
function reset(){batch.value=null;selected.value='';detail.value=null;progress.value=''}
function download(bytes,filename){const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function importFile(event){const file=event.target.files[0];if(file)await guarded(async()=>{text.value=(await importQuestions(file)).join('\n')});event.target.value=''}
async function post(url,data,config){for(let attempt=0;;attempt++){try{return await api.post(url,data,config)}catch(e){if(e.response?.status!==429||attempt>=2)throw e;const seconds=Math.min(120,Math.max(1,Number(e.response.headers?.['retry-after'])||60));progress.value=`限流，${seconds}秒后继续`;for(let i=0;i<seconds;i++){if(!alive||stopped.value)throw new Error('已暂停');await new Promise(r=>setTimeout(r,1000))}}}}
function acceptBatch(next){if(!batch.value||next._id!==batch.value._id||(next.revision||0)>=(batch.value.revision||0))batch.value=next}
async function run(){await guarded(async()=>{
 stopped.value=false
 if(!batch.value){batch.value=(await post(base,{name:name.value||`图谱相关性实验 ${new Date().toLocaleString()}`,model:model.value,questions:questions.value})).data.batch;selected.value=batch.value._id}
 const exp=batch.value
 let cursor=0
 async function worker(){while(cursor<exp.questions.length){
  const index=cursor++
  if(stopped.value||!alive)break
  if(Number.isFinite(batch.value.rows.find(r=>r.index===index)?.metrics?.hit))continue
  const url=`${base}/${exp._id}/items/${index}`
  try{
   const item=(await api.get(url)).data.item
   progress.value=`第 ${index+1}/${exp.questions.length} 题：检索Top-${exp.k}及参考候选池`
   let runId=item.runHealthy?item.run?._id:null
   if(!runId)runId=(await post('/rag-tuning/retrieve',{query:exp.questions[index],k:exp.k,knowledgeId:'',retrievalMode:'graph',requestId:`graph-relevance-${exp._id}-${index}-${Date.now()}`,batchId:exp._id},{timeout:120000})).data.run._id
   progress.value=`第 ${index+1}/${exp.questions.length} 题：模型逐条判断相关性`
   for(let chunk=0;chunk<3;chunk++){
    const judged=(await post(`${url}/judge`,{runId},{timeout:270000})).data
    acceptBatch(judged.batch)
    progress.value=`第 ${index+1}/${exp.questions.length} 题：已标注 ${judged.item.poolReview?.length||0} / ${judged.item.referencePool?.length||0} 条候选`
    if(judged.item.metrics||stopped.value||!alive)break
   }
  }catch(e){
   error.value=`第${index+1}题：${explain(e)}`
   if(e.response?.status!==409){try{await api.post(`${url}/failure`,{error:explain(e)})}catch{}}
   acceptBatch((await api.get(`${base}/${exp._id}`)).data.batch)
   if(e.response?.status===409){stopped.value=true;break}
  }
 }
 }
 await Promise.allSettled(Array.from({length:3},()=>worker()))
 acceptBatch((await api.get(`${base}/${exp._id}`)).data.batch)
 progress.value=stopped.value?'已暂停，可从历史实验继续':'本轮结束，失败题可重试'
 await refresh()
})}
async function showDetail(index){await guarded(async()=>{detail.value=(await api.get(`${base}/${batch.value._id}/items/${index}`)).data.item})}
async function exportExcel(){await guarded(async()=>{
 const b=batch.value,s=b.summary
 const exportDefs=b.k===9?metricDefs:[['relatedRate','返回结果相关率'],['precision20','Precision@20'],['hit','Hit Rate@20']]
 const sheets=[{name:'实验汇总',rows:[['实验','评价模型','Top-k','总题数','已评分题数',...exportDefs.map(d=>d[1]),'口径'],[b.name,b.model,b.k,b.questions.length,s.completed,...exportDefs.map(d=>s[d[0]]?.value??null),b.k===9?'Recall与NDCG基于最多60条模型标注候选；MRR截断于9；Context relevance为0–4整体评分除以4；失败排除，无相关参考时Recall和NDCG不适用':'旧版Top-20实验，保持原始评分口径']]},{name:'逐题结果',rows:[['题号','问题','状态','实际返回条数','相关条数',...exportDefs.map(d=>d[1]),'参考相关总数','错误']]},{name:'逐条判断',rows:[['题号','排名','图谱ID','图谱内容','是否相关','判断理由','支持原文']]},{name:'原始记录',rows:[['题号','分段','JSON（按顺序拼接）']]},{name:'候选池标注',rows:[['题号','图谱ID','内容','是否相关','理由']]},{name:'上下文评分',rows:[['题号','0–4原始评分','归一化分数','理由']]}]
 for(const row of rows.value){
  const m=row.metrics||{};sheets[1].rows.push([row.index+1,row.query,row.state||'未执行',m.returned??null,m.relevant??null,...exportDefs.map(d=>m[d[0]]??null),m.referenceRelevantCount??null,row.error||''])
  const item=(await api.get(`${base}/${b._id}/items/${row.index}`)).data.item
  for(const [rank,e] of (item.run?.results||[]).entries()){const v=item.review?.find(v=>v.id===e.evaluationId);sheets[2].rows.push([row.index+1,rank+1,e.evaluationId,e.content,v?.relevant??null,v?.reason||'',v?.quote||''])}
  for(const e of item.referencePool||[]){const v=item.poolReview?.find(v=>v.id===e.evaluationId);sheets[4].rows.push([row.index+1,e.evaluationId,e.content,v?.relevant??null,v?.reason||''])}
  sheets[5].rows.push([row.index+1,item.contextJudgment?.rawScore??null,item.metrics?.contextRelevance??null,item.contextJudgment?.reason||''])
  const raw=JSON.stringify(item);for(let start=0,n=1;start<raw.length;n++){let end=Math.min(start+28000,raw.length);if(/[\uD800-\uDBFF]/.test(raw[end-1]))end--;sheets[3].rows.push([row.index+1,n,raw.slice(start,end)]);start=end}
 }
 download(workbookBytes(sheets),'图谱检索相关性评估.xlsx')
})}
onMounted(()=>guarded(refresh))
onBeforeUnmount(()=>{alive=false;stopped.value=true})
</script>

<template>
 <section class="graph-relevance">
  <h3>图谱检索相关性评估</h3>
  <p>同时处理3题，每题评价Top-9图谱结果，同时由模型标注最多60条候选作为参考集合，计算六项检索指标。</p>
  <el-alert v-if="error" :title="error" type="error" :closable="false" />
  <div class="toolbar"><el-select v-model="selected" placeholder="打开历史实验" :disabled="busy" @change="load"><el-option v-for="h in history" :key="h._id" :value="h._id" :label="h.name" /></el-select><el-button :disabled="busy" @click="guarded(refresh)">刷新历史</el-button><el-button v-if="batch" :disabled="busy" @click="reset">新建实验</el-button></div>
  <template v-if="!batch">
   <div class="toolbar"><el-button :disabled="busy||!auth.isAdmin" @click="upload.click()">上传问题文件</el-button><el-button @click="download(templateWorkbook(),'图谱评估问题模板.xlsx')">下载模板</el-button><span>{{questions.length}} / 100题</span></div>
   <input ref="upload" type="file" hidden accept=".xlsx,.csv,.txt,.json" @change="importFile">
   <el-input v-model="text" type="textarea" :rows="7" :disabled="busy||!auth.isAdmin" placeholder="上传XLSX、CSV、TXT、JSON，或每行粘贴一道问题" />
   <div class="toolbar"><el-input v-model="name" maxlength="100" placeholder="实验名称（可选）" :disabled="busy" /><el-select v-model="model" :disabled="busy"><el-option v-for="m in models" :key="m" :label="m" :value="m" /></el-select><el-tag>仅知识图谱 · Top-9</el-tag></div>
  </template>
  <div class="toolbar"><el-button type="primary" :disabled="busy||!auth.isAdmin||(!batch&&(!questions.length||questions.length>100||!model))||(batch&&batch.summary.completed===batch.questions.length)" @click="run">{{batch?'继续 / 重试失败题':'开始评估'}}</el-button><el-button v-if="busy&&batch" :disabled="stopped" @click="stopped=true">当前标注批次结束后暂停</el-button><el-button v-if="batch" :disabled="busy" @click="exportExcel">导出Excel</el-button><span>{{progress}}</span></div>
  <p class="note">Recall@9＝前9条相关数÷参考池相关总数；Precision@9＝相关数÷9；MRR为前9条首个相关结果的倒数排名均值；NDCG@9使用二元相关性与参考池理想排序；Hit Rate@9为命中问题比例；Context relevance为模型整体0–4评分÷4。参考池无相关项时Recall与NDCG不适用。失败题不计分，执行时保持页面打开。参考池不是全图谱金标准。</p>
  <template v-if="batch">
   <el-alert v-if="batch.promptVersion!=='graph-six-metrics-v2'" title="这是旧Top-20实验，未计算六项新指标。请新建实验重跑，旧记录不自动换算。" type="info" :closable="false"/>
   <p>已评分 {{batch.summary.completed}} / {{batch.questions.length}} 题</p>
   <div class="cards"><div v-for="[key,label] in metricDefs" :key="key">{{label}}<strong>{{batch.k===9?pct(batch.summary[key]?.value):'—'}}</strong><small v-if="batch.k===9">有效 {{batch.summary[key]?.samples||0}} 题</small></div></div>
   <div class="toolbar"><h4>逐题指标（0–100%）</h4><el-select v-model="chartMetric"><el-option v-for="[key,label] in metricDefs" :key="key" :value="key" :label="label"/></el-select></div>
   <div class="chart"><div v-for="r in rows" :key="r.index" class="bar-row" :title="r.query"><span>第{{r.index+1}}题</span><div class="track"><div :style="{width:`${batch.k===9?(r.metrics?.[chartMetric]||0)*100:0}%`}" /></div><span>{{batch.k===9?pct(r.metrics?.[chartMetric]):'旧实验'}}</span></div></div>
   <el-table :data="rows" stripe><el-table-column label="题号" width="65"><template #default="{row}">{{row.index+1}}</template></el-table-column><el-table-column prop="query" label="问题" min-width="250"/><el-table-column v-for="[key,label] in metricDefs" :key="key" :label="label" min-width="130"><template #default="{row}">{{batch.k===9?pct(row.metrics?.[key]):'—'}}</template></el-table-column><el-table-column label="相关 / 返回" width="110"><template #default="{row}">{{row.metrics?`${row.metrics.relevant} / ${row.metrics.returned}`:'—'}}</template></el-table-column><el-table-column label="状态 / 错误" min-width="150"><template #default="{row}">{{row.error||row.state||'未执行'}}</template></el-table-column><el-table-column label="详情" width="100" fixed="right"><template #default="{row}"><el-button link :disabled="busy" @click="showDetail(row.index)">逐条查看</el-button></template></el-table-column></el-table>
  </template>
  <el-dialog :model-value="!!detail" title="图谱逐条相关性判断" width="85%" @close="detail=null"><template v-if="detail"><p>{{batch.questions[detail.index]}}</p><p v-if="detail.contextJudgment">Context relevance：{{pct(detail.contextJudgment.score)}}；{{detail.contextJudgment.reason}}</p><p v-if="detail.referencePool">参考池 {{detail.referencePool.length}} 条，已标注 {{detail.poolReview?.length||0}} 条。</p><el-table :data="(detail.run?.results||[]).map((e,i)=>({...e,rank:i+1,judgment:detail.review?.find(v=>v.id===e.evaluationId)}))"><el-table-column prop="rank" label="排名" width="65"/><el-table-column prop="content" label="图谱内容" min-width="280"/><el-table-column label="相关" width="80"><template #default="{row}">{{row.judgment?(row.judgment.relevant?'是':'否'):'未评分'}}</template></el-table-column><el-table-column label="理由" min-width="240"><template #default="{row}">{{row.judgment?.reason}}</template></el-table-column><el-table-column label="支持原文" min-width="200"><template #default="{row}">{{row.judgment?.quote}}</template></el-table-column></el-table><el-empty v-if="!detail.run?.results?.length" description="暂无图谱结果"/></template></el-dialog>
 </section>
</template>
<style scoped>
.graph-relevance{padding:10px}.graph-relevance p{color:#66758a;line-height:1.7}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:16px 0}.toolbar .el-input{max-width:300px}.toolbar .el-select{width:260px}.note{font-size:13px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0}.cards>div{padding:18px;background:#f3f7fc;border-radius:8px;color:#64748b}.cards strong{display:block;font-size:26px;color:#2563eb;margin-top:10px}.chart{max-height:400px;overflow:auto;padding:10px 0;margin-bottom:20px}.bar-row{display:grid;grid-template-columns:65px 1fr 110px;gap:14px;align-items:center;margin:12px 0;font-size:13px}.track{height:18px;background:#eef2f6;border-radius:4px;overflow:hidden}.track>div{height:100%;background:#409eff}.el-table{font-size:13px}@media(max-width:800px){.cards{grid-template-columns:repeat(2,1fr)}}
</style>
