const {test}=require('node:test')
const assert=require('node:assert/strict')
const {createHarness}=require('./fixtures/rag-tuning-harness')
test('批量上传逐题标准、重复问题不丢失、评分失败续跑不重新生成',async t=>{
 const {http,token,state,tables}=createHarness()
 const embedding=require('../web-admin/server/utils/embeddingEvaluation'),original=embedding.evaluate
 let attempts=0,fail=true
 embedding.evaluate=async run=>{attempts++;if(fail&&run.reference==='标准二')throw Object.assign(new Error('模拟超时'),{status:504});return {standardScore:1,scores:Object.fromEntries([... 'ABCDE'].map(g=>[g,{similarity:0.8,accuracy:80}]))}}
 t.after(()=>{embedding.evaluate=original})
 const server=http.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close())
 const base=`http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests/batches`,headers={'Content-Type':'application/json',Authorization:`Bearer ${token('admin')}`}
 async function req(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,...await r.json()}}
 assert.equal((await req('',{evaluationMode:embedding.VERSION,cases:[{query:'问题',reference:''}]})).status,400)
 let job=(await req('',{evaluationMode:embedding.VERSION,cases:[{query:'相同问题',reference:'标准一'},{query:'相同问题',reference:'标准二'},{query:'后续问题',reference:'标准三'}]})).batch
 async function wait(){for(let i=0;i<300;i++){job=(await req('/'+job._id)).batch;if(!['queued','running'].includes(job.status))return;await new Promise(r=>setTimeout(r,20))}throw new Error('超时')}
 await wait();assert.equal(job.status,'completed_with_errors');assert.equal(job.ids.length,3);assert.deepEqual(job.references,['标准一','标准二','标准三']);assert.equal(state.modelCalls.length,15)
 assert.equal(tables.get('rag_answer_experiments').get(job.ids[1]).reference,'标准二')
 // Model an existing paused batch from the old implementation: failed item
 // remains pending, while the later item still needs its next phase.
 const stored=tables.get('rag_answer_batches').get(job._id)
 stored.status='paused';stored.pending=[1,2]
 const priorAttempts=attempts
 await req('/'+job._id+'/resume',{});await wait()
 assert.equal(attempts,priorAttempts,'继续旧批次时先处理后续题，不能先重试失败题')
 assert.deepEqual(job.pending,[]);assert.deepEqual(job.failures,[1])
 fail=false;await req('/'+job._id+'/resume',{});await wait();assert.equal(job.status,'completed');assert.equal(state.modelCalls.length,15);assert.equal(attempts,4)
 assert.equal(job.summaries[1].embeddingEvaluation.scores.E.accuracy,80)
 await req('/'+job._id+'/resume',{});assert.equal(attempts,4)
})
test('导入列匹配、空白行、逐行缺失校验及同题不同标准保留',async()=>{
 const {parseCases}=await import('../web-admin/client/src/views/tuning/embeddingBatchIO.mjs')
 assert.deepEqual(parseCases([['标准答案关键词','问题'],['甲','同题'],[],['乙','同题']]),[{query:'同题',reference:'甲'},{query:'同题',reference:'乙'}])
 assert.throws(()=>parseCases([['问题','标准答案'],['题','']]),/第1题/)
 assert.throws(()=>parseCases([['问题'],['题']]),/表头/)
})

test('向量上传超过100题不受固定题数上限限制',async()=>{
 const {validateCases}=await import('../web-admin/client/src/views/tuning/embeddingBatchIO.mjs')
 assert.equal(validateCases(Array.from({length:1001},(_,i)=>({query:`问题${i}`,reference:'标准'}))).length,1001)
})

test('综合评分采用共同有效题目等权平均，零分有效、缺失和截断不补零',async()=>{
 const {summarizeBatch}=await import('../web-admin/client/src/views/tuning/embeddingBatchIO.mjs')
 const run=value=>({embeddingEvaluation:{scores:Object.fromEntries([...'ABCDE'].map(g=>[g,{accuracy:value}]))}})
 const missing=run(100);missing.embeddingEvaluation.scores.C=null
 const truncated=run(100);truncated.variants={E:{finishReason:'length'}}
 const job={queries:['一','二','三','四','五'],summaries:{0:run(0),1:run(80),2:missing,3:truncated}}
 const summary=summarizeBatch(job)
 assert.equal(summary.length,5)
 for(const s of summary){assert.equal(s.score,40);assert.equal(s.samples,2);assert.equal(s.total,5)}
 assert.equal(summarizeBatch({queries:['未完成'],summaries:{}})[0].score,null)
 assert.equal(summarizeBatch(null)[0].samples,0)
})
