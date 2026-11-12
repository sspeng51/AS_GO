// Local authenticated diagnosis; never print credentials or answer contents.
const path = require('path')
const root = path.resolve(__dirname, '../web-admin/server')
require(require.resolve('dotenv', { paths: [root] })).config({ path: path.join(root, '.env'), quiet: true })
const axios = require(require.resolve('axios', { paths: [root] }))
const { generateToken } = require(path.join(root, 'middleware/auth'))
async function main() {
  const id = process.argv[2], action = process.argv[3] || 'status'
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id || '') || !['status', 'judge', 'repair', 'refresh-batch', 'inspect'].includes(action)) throw Error('Invalid arguments')
  const client = axios.create({ baseURL: 'http://localhost:3000/api/rag-tuning/answer-tests/', timeout: 360000, headers: { Authorization: 'Bearer ' + generateToken({ username: 'local-rag-diagnostic', role: 'admin' }, '10m') } })
  if (action === 'refresh-batch') { console.log((await client.post('batches/' + id + '/refresh', {})).data); return }
  if (action === 'judge' || action === 'repair') {
    const initial = (await client.get(id)).data.experiment
    if (initial.active) throw Error('实验仍在执行')
    try { await client.post(id + '/' + action, {}) } catch (e) { console.log(JSON.stringify({ status: e.response?.status, error: e.response?.data?.error || e.message })) }
  }
  const r = (await client.get(id)).data.experiment
  if (action === 'inspect') {
    const raw=r.calls.at(-1).output || '', pos=Number(r.calls.at(-1).validationError?.match(/position (\d+)/)?.[1] || 0)
    console.log(JSON.stringify({nearError:raw.slice(Math.max(0,pos-160),pos+160),citationStart:raw.slice(raw.indexOf('citationReviews')-100,raw.indexOf('citationReviews')+200),end:raw.slice(-300),complete:require(path.join(root,'utils/partialReviews')).completedReviews(raw).map(x=>({id:x.id,fields:Object.keys(x.result),outer:Object.keys(x)}))}));return
  }
  console.log(JSON.stringify({ id, active: r.active, lastError: r.lastError, call: { ...r.calls.at(-1), output: undefined, partialAnswer: undefined }, groups: Object.fromEntries(Object.entries(r.variants).map(([k, v]) => [k, { status: v.judge?.status, scores: Object.fromEntries(Object.entries(v.judge?.metrics || {}).map(([name, m]) => [name, m.value == null ? null : +(100 * m.value).toFixed(1)])), warnings: v.judge?.warnings }])) }, null, 2))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
