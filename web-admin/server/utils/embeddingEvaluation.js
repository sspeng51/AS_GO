const axios = require('axios')
const VERSION = 'embedding-3-cosine-v1'
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length || [...a,...b].some(x => !Number.isFinite(x))) throw new Error('无效向量或维度不一致')
  const norm = x => Math.hypot(...x)
  const na = norm(a), nb = norm(b)
  if (!na || !nb) throw new Error('不能计算零向量相似度')
  return Math.max(-1, Math.min(1, a.reduce((sum,x,i) => sum + (x/na)*(b[i]/nb), 0)))
}
async function evaluate(run, post = axios.post) {
  const key = process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY
  if (!key) throw Object.assign(new Error('请配置后台智谱 API Key'), {status:400})
  const entries = [['reference',run.reference], ...Object.entries(run.variants).filter(([,v]) => v.answer && v.finishReason !== 'length').map(([g,v]) => [g,v.answer])]
  const vectors = {}, calls = []
  // Small UTF-8 chunks stay below the provider token limit without silently truncating text.
  for (const [id,text] of entries) {
    const chunks = []; let chunk = ''
    for (const char of text) { if (Buffer.byteLength(chunk + char,'utf8') > 2400) { chunks.push(chunk); chunk = '' } chunk += char }
    if (chunk) chunks.push(chunk)
    if (!chunks.length) throw new Error('标准和回答不能为空')
    const sum = Array(2048).fill(0); let weight = 0
    for (const input of chunks) {
      const {data} = await post('https://open.bigmodel.cn/api/paas/v4/embeddings', {model:'embedding-3',dimensions:2048,input}, {timeout:60000,headers:{Authorization:`Bearer ${key}`}})
      const vector = data?.data?.[0]?.embedding
      if (vector?.length !== 2048) throw new Error('智谱返回的向量维度异常')
      cosine(vector,vector)
      const w = Buffer.byteLength(input,'utf8'); vector.forEach((v,i) => { sum[i] += v*w }); weight += w
      calls.push({target:id,usage:data.usage || null})
    }
    vectors[id] = sum.map(v=>v/weight)
  }
  const standardScore = cosine(vectors.reference,vectors.reference)
  const scores = Object.fromEntries('ABCDE'.split('').map(g => [g, vectors[g] ? {similarity:cosine(vectors[g],vectors.reference), accuracy:cosine(vectors[g],vectors.reference)/standardScore*100} : null]))
  return {version:VERSION,model:'embedding-3',dimensions:2048,aggregation:'2400-byte chunks, byte-weighted mean',standardScore,scores,calls,createdAt:new Date().toISOString()}
}
module.exports = {VERSION,cosine,evaluate}
