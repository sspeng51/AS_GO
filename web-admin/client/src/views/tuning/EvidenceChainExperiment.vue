<script setup>
import { DEFAULT_KNOWLEDGE_ID } from './defaultKnowledge.mjs'
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { importQuestions, templateWorkbook, resultWorkbook } from './evidenceAutoIO.mjs'
const auth=useAuthStore(), base='/rag-tuning/auto-evidence'
const text=ref(''), model=ref('glm-5.3-flash'), models=ref([]), mode=ref('hybrid'), k=ref(5), knowledgeId = ref(DEFAULT_KNOWLEDGE_ID), name=ref(''), corpusVersion=ref('')
const batch=ref(null), history=ref([]), selected=ref(''), busy=ref(false), stopped=ref(false), error=ref(''), progress=ref(''), upload=ref(null), detail=ref(null), chartMode=ref('summary')
let alive=true
const questions=computed(()=>text.value.split(/\r?\n/).map(q=>q.trim()).filter(Boolean))
const pct=v=>Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'—'
const rows=computed(()=>batch.value?.questions.map((q,i)=>({index:i,query:q,...batch.value.rows.find(r=>r.index===i)}))||[])
const completed=computed(()=>rows.value.filter(r=>Number.isFinite(r.metrics?.chain)).length)
const explain=e=>e.response?.data?.error||e.message
async function post(url,data,config){
  for(let attempt=0;;attempt++){
    try{return await api.post(url,data,config)}catch(e){
      if(e.response?.status!==429||attempt>=2)throw e
      const seconds=Math.min(120,Math.max(1,Number(e.response.headers?.['retry-after'])||60))
      progress.value=`请求限流，等待 ${seconds} 秒后自动继续`
      for(let i=0;i<seconds;i++){if(stopped.value||!alive)throw new Error('已暂停');await new Promise(r=>setTimeout(r,1000))}
    }
  }
}
async function guarded(fn){busy.value=true;error.value='';try{await fn()}catch(e){error.value=explain(e)}finally{busy.value=false}}
async function refresh(){const {data}=await api.get(base);history.value=data.batches;models.value=data.models;if(!models.value.includes(model.value))model.value=models.value[0]||''}
async function load(){if(!selected.value)return;await guarded(async()=>{batch.value=(await api.get(`${base}/${selected.value}`)).data.batch})}
function download(bytes,filename){const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function importFile(event){const file=event.target.files[0];if(!file)return;await guarded(async()=>{text.value=(await importQuestions(file)).join('\n')});event.target.value=''}
function newBatch(){batch.value=null;selected.value='';detail.value=null;progress.value='';error.value=''}
function rerunWithNewRules(){
  const old=batch.value
  text.value=old.questions.join('\n');model.value=old.model;mode.value=old.mode;k.value=Math.max(old.k,old.mode==='hybrid'?2:1);knowledgeId.value=old.knowledgeId;corpusVersion.value=old.corpusVersion||'';name.value=`${old.name.slice(0,75)} · 新规则重跑`
  newBatch()
}
async function run(){await guarded(async()=>{
  stopped.value=false
  if(!batch.value){
    if(questions.value.length<1||questions.value.length>100)throw new Error('请上传1–100道问题')
    batch.value=(await api.post(base,{name:name.value||`自动证据链实验 ${new Date().toLocaleString()}`,corpusVersion:corpusVersion.value||'未指定',model:model.value,mode:mode.value,k:k.value,knowledgeId:mode.value==='graph'?'':knowledgeId.value.trim(),questions:questions.value})).data.batch
    selected.value=batch.value._id
  }
  const exp=batch.value;let failed=0
  for(let index=0;index<exp.questions.length;index++){
    if(stopped.value||!alive)break
    if(Number.isFinite(batch.value.rows.find(r=>r.index===index)?.metrics?.chain))continue
    const url=`${base}/${exp._id}/items/${index}`
    try{
      progress.value=`第 ${index+1}/${exp.questions.length} 题 · GLM 生成必要证据标准`
      const prepared=await post(`${url}/prepare`,{},{timeout:270000});batch.value=prepared.data.batch
      progress.value=`第 ${index+1}/${exp.questions.length} 题 · 检索知识库与图谱`
      const savedRun=prepared.data.item.run
      // Resume a successful retrieval after a judge error; retry unhealthy retrievals with a new request ID.
      let runId=savedRun?._id
      if(!runId||prepared.data.item.runHealthy!==true)runId=null
      if(!runId){const result=await post('/rag-tuning/retrieve',{query:exp.questions[index],k:exp.k,knowledgeId:exp.knowledgeId,retrievalMode:exp.mode,requestId:`auto-chain-${exp._id}-${index}-${Date.now()}`,batchId:exp._id},{timeout:120000});runId=result.data.run._id}
      progress.value=`第 ${index+1}/${exp.questions.length} 题 · GLM 自动标注与评分`
      batch.value=(await post(`${url}/judge`,{runId},{timeout:270000})).data.batch
    }catch(e){
      failed++;const message=explain(e)
      if(e.response?.status!==409){try{await api.post(`${url}/failure`,{error:message})}catch{}}
      try{batch.value=(await api.get(`${base}/${exp._id}`)).data.batch}catch{}
      const row=batch.value.rows.find(r=>r.index===index)
      if(!row?.metrics){batch.value.rows=batch.value.rows.filter(r=>r.index!==index).concat({index,state:'失败',error:message,metrics:null})}
      error.value=`第${index+1}题：${message}`
      if(e.response?.status===409){stopped.value=true;break}
    }
  }
  progress.value=stopped.value?'已暂停，可继续未完成题目':`本轮执行结束${failed?`，${failed}题失败，可重试`:'，结果已保存'}`
  await refresh()
})}
async function showDetail(index){await guarded(async()=>{detail.value=(await api.get(`${base}/${batch.value._id}/items/${index}`)).data.item})}
async function exportExcel(){await guarded(async()=>{
  const items=[]
  for(let i=0;i<batch.value.questions.length;i++){progress.value=`正在准备导出 ${i+1}/${batch.value.questions.length}`;items.push((await api.get(`${base}/${batch.value._id}/items/${i}`)).data.item)}
  download(resultWorkbook(batch.value,items),'证据链自动评估.xlsx');progress.value='Excel导出完成'
})}
onMounted(()=>guarded(refresh))
onBeforeUnmount(()=>{alive=false;stopped.value=true})
</script>

<template>
  <section class="auto-chain">
    <header><div><h3>证据链自动评估</h3><p>上传问题，让 GLM 完成证据标注与评分，自动生成实验图表。</p></div><el-tag effect="plain">最多 100 题 · 自动保存</el-tag></header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <div class="toolbar history"><el-select v-model="selected" placeholder="打开历史实验" filterable :disabled="busy" @change="load"><el-option v-for="h in history" :key="h._id" :value="h._id" :label="`${h.name} · ${h.questions.length}题`" /></el-select><el-button :disabled="busy" @click="guarded(refresh)">刷新</el-button><el-button v-if="batch" :disabled="busy" @click="newBatch">新建实验</el-button><el-button v-if="batch" :disabled="busy||!auth.isAdmin" @click="rerunWithNewRules">按新规则重跑这批问题</el-button></div>
    <div v-if="!batch" class="setup">
      <div class="upload-card"><span class="step">01 / 上传问题</span><h4>只需要准备问题，无需人工标注</h4><p>支持 Excel（.xlsx）、CSV、TXT 和 JSON。Excel 读取首个工作表的“问题”列；TXT 每行一道题。</p><div class="toolbar"><el-button type="primary" :disabled="busy||!auth.isAdmin" @click="upload.click()">上传问题文件</el-button><el-button :disabled="busy" @click="download(templateWorkbook(),'证据链问题模板.xlsx')">下载 Excel 模板</el-button><el-tag>{{ questions.length }} / 100 题</el-tag></div><input ref="upload" type="file" hidden accept=".xlsx,.csv,.txt,.json" @change="importFile"><el-input v-model="text" type="textarea" :rows="8" :disabled="busy||!auth.isAdmin" placeholder="也可以直接粘贴问题，每行一道题" /></div>
      <div class="config-card"><span class="step">02 / 选择评估模型</span><el-form label-position="top" :disabled="busy||!auth.isAdmin"><el-form-item label="自动标注与评价模型"><el-select v-model="model"><el-option v-for="m in models" :key="m" :label="m==='glm-5.3-flash'?'GLM-5.3-Flash':'GLM-5.3'" :value="m" /></el-select></el-form-item><el-form-item label="检索范围"><el-select v-model="mode"><el-option label="RAG + 知识图谱" value="hybrid" /><el-option label="知识库 RAG" value="knowledge" /><el-option label="知识图谱" value="graph" /></el-select></el-form-item><el-form-item label="Top-k"><el-input-number v-model="k" :min="1" :max="20" /></el-form-item><el-collapse><el-collapse-item title="更多设置（可选）"><el-input v-model="name" maxlength="100" placeholder="实验名称" /><el-input v-model="knowledgeId" :disabled="mode==='graph'" placeholder="知识库ID，留空使用默认库" /><el-input v-model="corpusVersion" maxlength="100" placeholder="知识库版本标记" /></el-collapse-item></el-collapse></el-form></div>
    </div>
    <div class="toolbar run-controls"><el-button v-if="auth.isAdmin" type="primary" size="large" :disabled="busy||(!batch&&(!questions.length||questions.length>100||!model))||(batch&&completed===batch.questions.length)" @click="run">{{ batch?'继续 / 重试未完成题目':'开始自动评估' }}</el-button><el-button v-if="busy&&batch" :disabled="stopped" @click="stopped=true">{{ stopped?'当前题结束后暂停':'暂停批量执行' }}</el-button><el-button v-if="batch" :disabled="busy" @click="exportExcel">导出 Excel 表格</el-button><span>{{ progress }}</span></div>
    <p class="hint">模型先根据问题制定标准，再依据检索原文评分。结果属于模型自动评估，非人工金标准；失败题不计零分。执行期间保持页面打开，暂停或刷新后可从历史实验继续。</p>
    <template v-if="batch"><el-alert v-if="batch.promptVersion!=='auto-evidence-v4-atomic-facts'" title="这是旧规则实验。点击“按新规则重跑这批问题”生成独立的新实验，原记录保持不变。" type="info" :closable="false" />
      <div class="metric-cards"><div><span>必要证据覆盖率</span><strong>{{ pct(batch.summary.coverage.value) }}</strong><small>有效 {{ batch.summary.coverage.samples }} 题</small></div><div><span>完整证据链成功率</span><strong>{{ pct(batch.summary.chain.value) }}</strong><small>有效 {{ batch.summary.chain.samples }} 题</small></div><div><span>评估进度</span><strong>{{ completed }} / {{ batch.questions.length }}</strong><small>{{ batch.model }} · Top-{{ batch.k }}</small></div></div>
      <el-progress :percentage="Math.round(completed/batch.questions.length*100)" />
      <div class="chart-card"><div class="toolbar"><h4>实验结果柱状图</h4><el-radio-group v-model="chartMode"><el-radio-button value="summary">整体指标</el-radio-button><el-radio-button value="questions">逐题对比</el-radio-button></el-radio-group><span>蓝：必要证据覆盖率　绿：完整证据链成功</span></div>
        <div v-if="chartMode==='summary'" class="summary-bars" role="img" :aria-label="`必要证据覆盖率${pct(batch.summary.coverage.value)}，完整证据链成功率${pct(batch.summary.chain.value)}`"><div v-for="(metric,i) in [batch.summary.coverage,batch.summary.chain]" :key="i" class="bar-slot"><strong>{{ pct(metric.value) }}</strong><div class="bar-track"><div class="bar" :class="{green:i===1}" :style="{height:`${(metric.value||0)*100}%`}" /></div><span>{{ i===0?'必要证据覆盖率':'完整证据链成功率' }}</span></div><div class="axis">100%<br>75%<br>50%<br>25%<br>0%</div></div>
        <div v-else class="question-chart"><div class="question-bars"><div v-for="row in rows" :key="row.index" class="question-bar" :title="`${row.query}\n覆盖率：${pct(row.metrics?.coverage)}\n完整链：${row.metrics?.chain??'未评分'}`"><div class="bar-pair"><div class="bar" :style="{height:`${(row.metrics?.coverage||0)*100}%`}" /><div class="bar green" :style="{height:`${(row.metrics?.chain||0)*100}%`}" /></div><small>{{ row.metrics?'':'—' }}</small><span>{{ row.index+1 }}</span></div></div><p>横轴为题号，纵轴为 0–100%；完整链成功为100%，失败为0%。未评分显示“—”。</p></div>
      </div>
      <el-table :data="rows" stripe max-height="520"><el-table-column label="题号" width="70"><template #default="{row}">{{ row.index+1 }}</template></el-table-column><el-table-column prop="query" label="问题" min-width="300" /><el-table-column label="覆盖率" width="110"><template #default="{row}">{{ pct(row.metrics?.coverage) }}</template></el-table-column><el-table-column label="完整链" width="100"><template #default="{row}">{{ row.metrics?.chain===1?'成功':row.metrics?.chain===0?'不完整':'—' }}</template></el-table-column><el-table-column label="状态 / 错误" min-width="180"><template #default="{row}">{{ row.error||row.state||'待执行' }}</template></el-table-column><el-table-column label="文档 / 图谱" width="110"><template #default="{row}">{{ row.evidenceSelection ? `${row.evidenceSelection.selectedDocuments} / ${row.evidenceSelection.selectedGraph}` : '—' }}</template></el-table-column><el-table-column label="依据" width="100"><template #default="{row}"><el-button link type="primary" :disabled="busy||!row.state" @click="showDetail(row.index)">查看标注</el-button></template></el-table-column></el-table>
    </template>
    <el-dialog :model-value="!!detail" title="模型标注与评分依据" width="85%" @close="detail=null"><template v-if="detail"><p>{{ batch.questions[detail.index] }}</p><el-alert v-if="detail.error" :title="detail.error" type="error" :closable="false" /><section v-for="(p,pi) in detail.standard?.paths" :key="pi"><h4>{{ p.name }}</h4><div v-for="(point,j) in p.points" :key="j" class="annotation"><strong>{{ j+1 }}. {{ point.text }}</strong><p>{{ detail.review?.[pi]?.points[j]?.supported===true?'✓ 已覆盖':detail.review?.[pi]?.points[j]?.supported===false?'✕ 未覆盖':'待评价' }} · {{ detail.review?.[pi]?.points[j]?.note }}</p><blockquote v-for="(citation,ci) in detail.review?.[pi]?.points[j]?.citations" :key="ci">{{ citation.quote }}<small>{{ citation.locator }} · {{ citation.id }}</small></blockquote></div><p v-for="(link,j) in p.links" :key="j">连接 {{ link.from+1 }} → {{ link.to+1 }}：{{ link.condition }}<br>{{ detail.review?.[pi]?.links[j]?.valid===true?'✓ 成立':detail.review?.[pi]?.links[j]?.valid===false?'✕ 不成立':'待评价' }} · {{ detail.review?.[pi]?.links[j]?.reason }}</p></section><el-collapse><el-collapse-item title="本次原始检索证据"><article v-for="source in detail.run?.results" :key="source.evaluationId"><h4>{{ source.title }}</h4><p class="source">{{ source.content }}</p></article></el-collapse-item></el-collapse></template></el-dialog>
  </section>
</template>

<style scoped>
.auto-chain{padding:12px;color:#243b53}.auto-chain header,.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.auto-chain header{justify-content:space-between;margin-bottom:22px}h3{font-size:23px;margin:0 0 10px}h4{font-size:16px}.auto-chain p,.hint{color:#6b7b8d;line-height:1.7}.history{margin-bottom:20px}.history .el-select{width:330px}.setup{display:grid;grid-template-columns:2fr 1fr;gap:20px}.upload-card,.config-card,.chart-card{border:1px solid #e3eaf3;border-radius:12px;padding:24px;background:white}.upload-card{background:linear-gradient(130deg,#f3f7ff,#fff)}.step{color:#4274cb;font-size:12px;letter-spacing:1px;font-weight:700}.upload-card .toolbar{margin:22px 0 18px}.config-card .el-form{margin-top:18px}.config-card .el-input{margin:5px 0}.run-controls{margin:22px 0 8px}.run-controls span,.toolbar span{font-size:13px;color:#6b7b8d}.hint{font-size:12px}.metric-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:24px 0}.metric-cards>div{padding:24px;background:#f5f8fe;border:1px solid #e3eaf3;border-radius:12px}.metric-cards span,.metric-cards strong,.metric-cards small{display:block}.metric-cards strong{font-size:34px;margin:12px 0;color:#2864ce}.metric-cards small{color:#748498}.chart-card{margin:20px 0}.summary-bars{position:relative;display:flex;justify-content:center;gap:90px;padding:25px 30px 0 65px}.bar-slot{width:190px;text-align:center}.bar-slot>strong{display:block;margin:5px}.bar-track{height:220px;display:flex;align-items:flex-end;border-bottom:1px solid #cbd5e1;background:repeating-linear-gradient(to top,#fff 0,#fff 54px,#e8edf4 55px)}.bar{width:65%;margin:auto auto 0;background:#4c83ec;border-radius:5px 5px 0 0;min-height:0}.green{background:#2eaf91}.bar-slot>span{display:block;margin-top:14px}.axis{position:absolute;left:5px;top:41px;height:220px;line-height:55px;font-size:12px;color:#8391a3;transform:translateY(-27px)}.question-chart{overflow-x:auto}.question-bars{display:flex;gap:14px;padding:15px 5px;min-width:100%;width:max-content}.question-bar{width:42px;text-align:center;font-size:12px}.bar-pair{height:180px;display:flex;align-items:flex-end;gap:3px;border-bottom:1px solid #ccd6e5;background:repeating-linear-gradient(to top,#fff 0,#fff 44px,#e8edf4 45px)}.bar-pair .bar{width:19px}.question-bar small{height:14px;display:block}.annotation{padding:14px;margin:10px 0;background:#f6f8fb;border-radius:8px}blockquote{margin:10px 0;padding:12px;border-left:3px solid #7da6f5;background:white}blockquote small{display:block;color:#8190a3;margin-top:8px}.source{white-space:pre-wrap}@media(max-width:900px){.setup{grid-template-columns:1fr}.metric-cards{grid-template-columns:1fr}.summary-bars{gap:20px}.bar-slot{width:135px}}
</style>
