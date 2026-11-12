const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./fixtures/rag-tuning-harness')
test('集中评审超时暂停批次，恢复不重复生成或标准制定', async t => {
  const {http,token,state,tables}=createHarness()
  state.judgeTimeoutOnce=true
  const server=http.listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close())
  const base=`http://127.0.0.1:${server.address().port}/api/rag-tuning/answer-tests/batches`
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${token('admin')}`}
  let job=(await(await fetch(base,{method:'POST',headers,body:JSON.stringify({queries:['超时第一题','后续第二题']})})).json()).batch
  async function wait(status){
    const end=Date.now()+10000
    while(job.status!==status&&Date.now()<end){await new Promise(r=>setTimeout(r,15));job=(await(await fetch(`${base}/${job._id}`,{headers})).json()).batch}
    assert.equal(job.status,status)
  }
  await wait('paused')
  assert.ok(state.modelCalls.length >= 7 && state.modelCalls.length <= 14)
  assert.equal(job.pending.length,2)
  assert.equal(Object.keys(job.summaries).length,2)
  assert.equal(Object.values(job.summaries[0].variants).filter(v=>v.hasAnswer).length,5)
  assert.match(job.lastError,/回答集中评审.*90 秒/)
  const call=tables.get('rag_answer_experiments').get(job.ids[0]).calls.at(-1)
  assert.equal(call.success,false);assert.equal(call.errorCode,'ECONNABORTED')
  assert.equal(call.timeoutMs,300000)
  assert.ok(state.modelOptions.every(o=>o.timeout===90000))
  await fetch(`${base}/${job._id}/resume`,{method:'POST',headers})
  await wait('completed')
  assert.equal(state.modelCalls.length,15)
  assert.equal(state.collectionCreates.rag_answer_experiments,1)
  assert.equal(state.collectionCreates.rag_answer_batches,1)
  assert.equal(state.modelCalls.filter(c=>c.messages[0].content.includes('你是回答对比标准制定员')).length,2)
})
