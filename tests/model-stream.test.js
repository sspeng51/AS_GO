const {test}=require('node:test')
const assert=require('node:assert/strict')
const {Readable}=require('stream')
const {readModelStream,streamingCompletion}=require('../web-admin/server/utils/modelStream')
test('重复输出及时中止并保留原文，不接受异常结果',async()=>{
 const content='{"reviews":[{"reason":"'+ '争!'.repeat(150)
 await assert.rejects(readModelStream(Readable.from(['data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n'])), e=>e.code==='MODEL_REPETITION'&&e.partialAnswer===content)
})
test('正常重复结构的评分JSON不会触发循环保护',async()=>{
 const content=JSON.stringify({reviews:Array.from({length:40},(_,i)=>({id:i,score:100}))})
 const r=await readModelStream(Readable.from(['data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\n']))
 assert.equal(r.answer,content)
})
test('SSE跨字节中文、多帧、思考、最终usage独立帧完整接收',async()=>{
 const events=[{choices:[{delta:{reasoning_content:'核验'}}]},{choices:[{delta:{content:'砷的处理。'}}]},{choices:[{delta:{},finish_reason:'stop'}]},{choices:[],usage:{total_tokens:12}}]
 const bytes=Buffer.from(events.map(v=>'data: '+JSON.stringify(v)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n')
 const r=await readModelStream(Readable.from([...bytes].map(b=>Buffer.from([b]))))
 assert.equal(r.answer,'砷的处理。');assert.equal(r.usage.total_tokens,12);assert.equal(r.reasoningChars,2)
})
test('断流保留片段但不可计作完成答案',async()=>{
 const data=Readable.from(['data: '+JSON.stringify({choices:[{delta:{content:'未完成'}}]})+'\n\n'])
 await assert.rejects(readModelStream(data),e=>e.partialAnswer==='未完成'&&e.status===502)
})
test('只有思考且用尽预算不能当有效正文',async()=>{
 await assert.rejects(readModelStream(Readable.from(['data: '+JSON.stringify({choices:[{delta:{reasoning_content:'思考'},finish_reason:'length'}]})+'\n\n'])),/未返回正文/)
})
test('流式总时限取消上游且不追加重试',async()=>{
 let calls=0
 const axios={post:async(url,body,opts)=>{calls++;const data=new Readable({read(){}});opts.signal.addEventListener('abort',()=>data.destroy(Object.assign(new Error('aborted'),{code:'ERR_CANCELED'})));return {data}}}
 const keepAlive=setTimeout(()=>{},1000)
 try{await assert.rejects(streamingCompletion(axios,'fake',{}, {requestTimeoutMs:20}),e=>e.code==='ETIMEDOUT')}finally{clearTimeout(keepAlive)}
 assert.equal(calls,1)
})
