// Cloud diagnostics; --sync-signing-key explicitly updates the remote signing key.
// Never prints credentials or environment values.
const path = require('path')
const { spawnSync } = require('child_process')
const root = path.resolve(__dirname, '..')
const serverRoot = path.join(root, 'web-admin/server')
require(require.resolve('dotenv', { paths: [serverRoot] })).config({ path: path.join(serverRoot, '.env') })
const envId = process.env.CLOUDBASE_ENV_ID
const childEnv = { ...process.env, TENCENTCLOUD_SECRETID: process.env.CLOUDBASE_SECRET_ID, TENCENTCLOUD_SECRETKEY: process.env.CLOUDBASE_SECRET_KEY }
const cli = path.join(root, 'node_modules/@cloudbase/cli/dist/standalone/cli.js')
const logs = process.argv.includes('--logs')
if (process.argv.includes('--invoke-trace')) {
  const { signTuningRequest } = require(path.join(serverRoot, 'utils/ragTuningAuth'))
  const payload = { query: '含磷酸盐的废水会怎样影响砷的吸附去除，原因是什么？', topK: 10, knowledgeId: process.env.ZHIPU_KNOWLEDGE_ID, retrievalMode: 'knowledge' }
  const signed = signTuningRequest(process.argv.includes('--sorted') ? Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))) : payload, process.env.RAG_TUNING_SHARED_SECRET || process.env.STREAM_SHARED_SECRET)
  const body = { FunctionName: 'processKnowledge', Namespace: envId, InvocationType: 'RequestResponse', LogType: 'Tail', ClientContext: JSON.stringify({ action: 'rag.tuning.search', data: signed }) }
  const fs = require('fs')
  const tmp = path.join(require('os').tmpdir(), `rag-trace-${require('crypto').randomUUID()}.cjs`)
  fs.writeFileSync(tmp, `const body = process.env.RAG_TRACE_BODY; delete process.env.RAG_TRACE_BODY; process.argv=[process.execPath,${JSON.stringify(cli)},'api','scf','Invoke','--api-version','2018-04-16','-e',${JSON.stringify(envId)},'--body',body,'--json']; require(${JSON.stringify(cli)});`)
  try {
    const result = spawnSync(process.execPath, [tmp], { cwd: root, env: { ...childEnv, RAG_TRACE_BODY: JSON.stringify(body) }, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
    const raw = result.stdout || ''
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    const data = parsed.Response || parsed.data || parsed
    const response = data.Result || data
    const log = String(response.Log || '')
    let returned = {}; try { returned = JSON.parse(response.RetMsg) } catch {}
    console.log(JSON.stringify({ errorCode: data.Error?.Code, errorMessage: data.Error?.Message, invokeResult: response.InvokeResult, success: returned.success, retrievalError: returned.error, evidenceCount: returned.evidences?.length, errorLines: log.split('\n').filter(line => /Unhandled error|签名|调优|Error:|at .*tuningAuth|at .*hybridRag/.test(line)).map(line => line.slice(0, 450)), logLength: log.length }))
  } finally { fs.unlinkSync(tmp) }
  process.exit(0)
}
const result = spawnSync(process.execPath, [cli, 'api', 'scf', logs ? 'GetFunctionLogs' : 'GetFunction', '--api-version', '2018-04-16', '-e', envId, '--body', JSON.stringify({ FunctionName: 'processKnowledge', Namespace: envId, ...(logs ? { Limit: 20 } : { ShowCode: 'FALSE' }) }), '--json'], { cwd: root, env: childEnv, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
const raw = result.stdout || ''
try {
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
  const data = parsed.Response || parsed.data || parsed
  if (logs) {
    if (data.Error) console.log(JSON.stringify({ errorCode: data.Error.Code, message: data.Error.Message }))
    else console.log(JSON.stringify((data.Data || []).map(item => ({ requestId: item.RequestId, time: item.StartTime, errors: String(item.Log || '').split('\n').filter(line => /Unhandled error|签名|调优|TypeError|ReferenceError/.test(line)).map(line => line.slice(0, 450)) })).filter(item => item.errors.length)))
    process.exit(data.Error ? 1 : 0)
  }
  if (data.Error) { console.log(JSON.stringify({ errorCode: data.Error.Code, message: data.Error.Message })); process.exitCode = 1 }
  else {
    const variables = data.Environment?.Variables || []
    const find = key => variables.find(item => item.Key === key)?.Value || ''
    const remoteSecret = find('RAG_TUNING_SHARED_SECRET') || find('STREAM_SHARED_SECRET')
    const localSecret = process.env.RAG_TUNING_SHARED_SECRET || process.env.STREAM_SHARED_SECRET || ''
    console.log(JSON.stringify({ functionName: data.FunctionName, modified: data.ModTime, variableCount: variables.length, cloudSigningConfigured: remoteSecret.length >= 32, localSigningConfigured: localSecret.length >= 32, signingKeysMatch: !!remoteSecret && remoteSecret === localSecret, hasCloudRagKey: !!find('RAG_TUNING_SHARED_SECRET'), hasCloudStreamKey: !!find('STREAM_SHARED_SECRET') }))
    if (process.argv.includes('--sync-signing-key')) {
      if (localSecret.length < 32) throw new Error('Local signing configuration invalid')
      if (remoteSecret === localSecret) console.log(JSON.stringify({ updated: false, alreadyMatches: true }))
      else {
        const updatedVariables = variables.filter(item => item.Key !== 'RAG_TUNING_SHARED_SECRET').map(({ Key, Value }) => ({ Key, Value }))
        updatedVariables.push({ Key: 'RAG_TUNING_SHARED_SECRET', Value: localSecret })
        // Sensitive request body is inherited through the child environment, not OS arguments.
        const crypto = require('crypto')
        const fs = require('fs')
        const tmp = path.join(require('os').tmpdir(), `rag-cloud-sync-${crypto.randomUUID()}.cjs`)
        const body = { FunctionName: 'processKnowledge', Namespace: envId, Environment: { Variables: updatedVariables } }
        // The child inherits secrets in memory; intercept argv only inside its process.
        const wrapper = `const body = JSON.parse(process.env.RAG_CONFIG_UPDATE_BODY); delete process.env.RAG_CONFIG_UPDATE_BODY; process.argv = [process.execPath, ${JSON.stringify(cli)}, 'api', 'scf', 'UpdateFunctionConfiguration', '--api-version', '2018-04-16', '-e', ${JSON.stringify(envId)}, '--body', JSON.stringify(body), '--json']; require(${JSON.stringify(cli)});`
        fs.writeFileSync(tmp, wrapper)
        try {
          const updated = spawnSync(process.execPath, [tmp], { cwd: root, env: { ...childEnv, RAG_CONFIG_UPDATE_BODY: JSON.stringify(body) }, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true })
          const out = updated.stdout || ''
          const parsedUpdate = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
          const updateData = parsedUpdate.Response || parsedUpdate.data || parsedUpdate
          console.log(JSON.stringify({ updated: updated.status === 0 && !updateData.Error, errorCode: updateData.Error?.Code, preservedVariableCount: variables.filter(item => item.Key !== 'RAG_TUNING_SHARED_SECRET').length }))
          if (updated.status !== 0 || updateData.Error) process.exitCode = 1
        } finally { fs.unlinkSync(tmp) }
      }
    }
  }
} catch {
  console.log(JSON.stringify({ cliExit: result.status, errorCode: result.error?.code, parsed: false, loginRequired: /login|登录/i.test(raw + result.stderr) }))
  process.exitCode = 1
}
