const {test}=require('node:test')
const assert=require('node:assert/strict')
const {cosine,evaluate}=require('../web-admin/server/utils/embeddingEvaluation')
test('余弦标准归一化及无效输入',()=>{
 assert.equal(cosine([1,0],[1,0]),1);assert.equal(cosine([1,0],[0,1]),0);assert.equal(cosine([1,0],[-1,0]),-1)
 assert.throws(()=>cosine([0,0],[1,0]));assert.throws(()=>cosine([1],[1,2]));assert.throws(()=>cosine([NaN],[1]))
})
test('全长分块、五组映射、截断留空、用量记录',async()=>{
 process.env.ZHIPU_API_KEY='fixture'
 const inputs=[]
 const post=async(url,body)=>{inputs.push(body.input);const v=Array(2048).fill(0);v[body.input==='不同'?1:0]=1;return {data:{data:[{embedding:v}],usage:{total_tokens:1}}}}
 const result=await evaluate({reference:'标准',variants:{A:{answer:'标准'},B:{answer:'不同'},C:{answer:'长'.repeat(1700)},D:{answer:'截断',finishReason:'length'},E:{answer:'标准'}}},post)
 assert.equal(result.standardScore,1);assert.equal(result.scores.A.accuracy,100);assert.equal(result.scores.B.accuracy,0);assert.equal(result.scores.D,null)
 assert.equal(inputs.filter(s=>s.startsWith('长')).join(''),'长'.repeat(1700));assert.ok(inputs.every(s=>Buffer.byteLength(s)<=2400));assert.equal(result.calls.length,inputs.length)
})
