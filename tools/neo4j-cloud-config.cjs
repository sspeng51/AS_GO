// Synchronize only Neo4j settings; never print credentials or raw CLI responses.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const root = path.resolve(__dirname, '..')
const dotenv = require(require.resolve('dotenv', { paths: [path.join(root, 'web-admin/server')] }))
dotenv.config({ path: path.join(root, 'web-admin/server/.env'), quiet: true })
const settings = dotenv.parse(fs.readFileSync(path.join(root, 'cloudfunctions/.env.local')))
const keys = process.argv.includes('--knowledge') ? ['ZHIPU_KNOWLEDGE_ID'] : ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'NEO4J_DATABASE', 'AURA_INSTANCEID', 'AURA_INSTANCENAME']
const envId = process.env.CLOUDBASE_ENV_ID
const cli = path.join(root, 'node_modules/@cloudbase/cli/dist/standalone/cli.js')
function api(action, extra = {}) {
  const body = { FunctionName: 'processKnowledge', Namespace: envId, ...extra }
  const script = 'const body=process.env.NEO4J_SYNC_BODY;delete process.env.NEO4J_SYNC_BODY;process.argv=[process.execPath,process.env.NEO4J_SYNC_CLI,"api","scf",process.env.NEO4J_SYNC_ACTION,"--api-version","2018-04-16","-e",process.env.CLOUDBASE_ENV_ID,"--body",body,"--json"];require(process.env.NEO4J_SYNC_CLI)'
  const result = spawnSync(process.execPath, ['-e', script], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, TENCENTCLOUD_SECRETID: process.env.CLOUDBASE_SECRET_ID, TENCENTCLOUD_SECRETKEY: process.env.CLOUDBASE_SECRET_KEY, NEO4J_SYNC_BODY: JSON.stringify(body), NEO4J_SYNC_CLI: cli, NEO4J_SYNC_ACTION: action } })
  const raw = result.stdout || ''
  let parsed
  try { parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) } catch { throw new Error('Cloud API response unavailable; exit=' + result.status) }
  const data = parsed.Response || parsed.data || parsed
  if (result.status !== 0 || data.Error) throw new Error(data.Error?.Code || 'Cloud API failed')
  return data
}
try {
  if (!envId || keys.some(key => !settings[key])) throw new Error('Missing local connection configuration')
  const current = api('GetFunction', { ShowCode: 'FALSE' })
  if (!Array.isArray(current.Environment?.Variables)) throw new Error('Cannot safely read existing environment')
  const variables = current.Environment.Variables
  const matches = keys.every(key => variables.find(v => v.Key === key)?.Value === settings[key])
  if (process.argv.includes('--apply') && !matches) {
    api('UpdateFunctionConfiguration', { Environment: { Variables: [...variables.filter(v => !keys.includes(v.Key)).map(({ Key, Value }) => ({ Key, Value })), ...keys.map(Key => ({ Key, Value: settings[Key] }))] } })
    console.log('Cloud environment updated; other variables preserved.')
  } else console.log(JSON.stringify({ matches, instance: settings.AURA_INSTANCEID, knowledgeId: settings.ZHIPU_KNOWLEDGE_ID }))
  if (process.argv.includes('--verify')) {
    const result = api('Invoke', { InvocationType: 'RequestResponse', ClientContext: JSON.stringify({ action: 'kb.graph.fetch', data: { refresh: true } }) })
    const output = JSON.parse(result.Result?.RetMsg || '{}')
    console.log(JSON.stringify({ invocationError: result.Result?.FunctionError, success: output.success, code: output.code, error: output.error, nodeCount: output.data?.nodes?.length ?? output.nodes?.length }))
    if (result.Result?.FunctionError || output.success === false || output.error) process.exitCode = 1
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
