#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx',
  '.txt', '.md', '.xls', '.xlsx', '.csv'
])

function parseArgs(argv) {
  const options = {
    dataDir: path.join(ROOT, 'DATA'),
    envFile: path.join(ROOT, 'web-admin', 'server', '.env'),
    concurrency: 3,
    maxFiles: 100,
    maxFileSizeMb: 100,
    retries: 3,
    knowledgeType: null,
    sentenceSize: 300,
    parseImage: false,
    force: false,
    dryRun: false
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const next = () => {
      const value = argv[++index]
      if (value === undefined) throw new Error(`${arg} 缺少参数值`)
      return value
    }
    if (arg === '--data-dir') options.dataDir = path.resolve(next())
    else if (arg === '--env-file') options.envFile = path.resolve(next())
    else if (arg === '--batch-size' || arg === '--concurrency') options.concurrency = Number(next())
    else if (arg === '--max-files') options.maxFiles = Number(next())
    else if (arg === '--max-file-size-mb') options.maxFileSizeMb = Number(next())
    else if (arg === '--retry-count') options.retries = Number(next())
    else if (arg === '--knowledge-type') options.knowledgeType = Number(next())
    else if (arg === '--sentence-size') options.sentenceSize = Number(next())
    else if (arg === '--parse-image') options.parseImage = true
    else if (arg === '--force') options.force = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数: ${arg}`)
  }

  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 10) {
    throw new Error('并发数范围必须是 1-10')
  }
  if (!Number.isInteger(options.maxFiles) || options.maxFiles < 1 || options.maxFiles > 1000) {
    throw new Error('max-files 范围必须是 1-1000')
  }
  if (!Number.isFinite(options.maxFileSizeMb) || options.maxFileSizeMb <= 0 || options.maxFileSizeMb > 100) {
    throw new Error('单文件上限范围必须是 0-100MB')
  }
  if (!Number.isInteger(options.retries) || options.retries < 0 || options.retries > 5) {
    throw new Error('重试次数范围必须是 0-5')
  }
  if (options.knowledgeType !== null && ![1, 2, 3, 5, 6, 7].includes(options.knowledgeType)) {
    throw new Error('knowledge-type 只能是 1、2、3、5、6、7')
  }
  if (!Number.isInteger(options.sentenceSize) || options.sentenceSize < 20 || options.sentenceSize > 2000) {
    throw new Error('sentence-size 范围必须是 20-2000')
  }

  return options
}

function printHelp() {
  console.log(`公共知识库批量导入

用法:
  node tools/batch-import.js [选项]

选项:
  --data-dir <目录>          文件目录，默认 ./DATA
  --env-file <文件>          环境变量文件，默认 web-admin/server/.env
  --concurrency <1-10>       并发上传数，默认 3
  --max-files <数量>         本次最多处理文件数，默认 100
  --max-file-size-mb <大小>  单文件上限，默认 100
  --retry-count <0-5>        失败重试次数，默认 3
  --knowledge-type <类型>    固定切片类型；不传时表格用 3，其余用 1
  --sentence-size <20-2000>  自定义切片大小，仅类型 5 生效
  --parse-image              解析文档中的图片
  --force                    忽略本地成功记录并重新上传
  --dry-run                  只扫描和校验，不调用 API
  -h, --help                 显示帮助`)
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const source = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function scanFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) scanFiles(fullPath, output)
    else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      output.push(fullPath)
    }
  }
  return output
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : { version: 1, files: {} }
  } catch (error) {
    return { version: 1, files: {} }
  }
}

function writeState(filePath, state) {
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8')
  fs.renameSync(temporary, filePath)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function inferKnowledgeType(filePath, configuredType) {
  if (configuredType) return configuredType
  return ['.csv', '.xls', '.xlsx'].includes(path.extname(filePath).toLowerCase()) ? 3 : 1
}

async function uploadFile(file, options, credentials) {
  const buffer = fs.readFileSync(file.path)
  const form = new FormData()
  form.append('files', new Blob([buffer]), path.basename(file.path))
  const knowledgeType = inferKnowledgeType(file.path, options.knowledgeType)
  form.append('knowledge_type', String(knowledgeType))
  form.append('parse_image', String(options.parseImage))
  form.append('req_id', crypto.randomUUID())
  if (knowledgeType === 5) form.append('sentence_size', String(options.sentenceSize))

  let lastError = null
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120000)
    try {
      const response = await fetch(
        `https://open.bigmodel.cn/api/llm-application/open/document/upload_document/${encodeURIComponent(credentials.knowledgeId)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${credentials.apiKey}` },
          body: form,
          signal: controller.signal
        }
      )
      const bodyText = await response.text()
      let body
      try {
        body = JSON.parse(bodyText)
      } catch (error) {
        throw new Error(`上传接口返回非 JSON 响应（HTTP ${response.status}）`)
      }

      const successInfo = body && body.data && Array.isArray(body.data.successInfos)
        ? body.data.successInfos[0]
        : null
      const failedInfo = body && body.data && Array.isArray(body.data.failedInfos)
        ? body.data.failedInfos[0]
        : null

      if (response.ok && Number(body.code) === 200 && successInfo) {
        return {
          documentId: successInfo.documentId,
          fileName: successInfo.fileName || path.basename(file.path)
        }
      }

      const message = failedInfo && failedInfo.failReason
        ? failedInfo.failReason
        : (body && body.message) || `HTTP ${response.status}`
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt >= options.retries) throw new Error(message)
      lastError = new Error(message)
    } catch (error) {
      lastError = error
      if (attempt >= options.retries || (error.name !== 'AbortError' && !/fetch failed/i.test(error.message))) {
        throw error
      }
    } finally {
      clearTimeout(timer)
    }
    await sleep(Math.min(1000 * (2 ** attempt), 8000))
  }
  throw lastError || new Error('上传失败')
}

async function runPool(items, concurrency, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  if (!fs.existsSync(options.dataDir) || !fs.statSync(options.dataDir).isDirectory()) {
    throw new Error(`数据目录不存在: ${options.dataDir}`)
  }

  loadEnvFile(options.envFile)
  const credentials = {
    apiKey: process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY || '',
    knowledgeId: process.env.ZHIPU_KNOWLEDGE_ID || ''
  }
  if (!options.dryRun && (!credentials.apiKey || !credentials.knowledgeId)) {
    throw new Error('缺少 ZHIPU_API_KEY 或 ZHIPU_KNOWLEDGE_ID，请配置环境变量或 --env-file')
  }

  const statePath = path.join(options.dataDir, '.batch-import-state.json')
  const state = readState(statePath)
  const maxBytes = Math.floor(options.maxFileSizeMb * 1024 * 1024)
  const scanned = scanFiles(options.dataDir).sort().slice(0, options.maxFiles)
  const invalid = []
  const skipped = []
  const pending = []

  for (const filePath of scanned) {
    const stat = fs.statSync(filePath)
    const relativePath = path.relative(options.dataDir, filePath)
    if (stat.size === 0 || stat.size > maxBytes) {
      invalid.push({ file: relativePath, reason: stat.size === 0 ? '空文件' : '超过体积上限' })
      continue
    }
    const hash = sha256File(filePath)
    if (!options.force && state.files && state.files[hash] && state.files[hash].status === 'success') {
      skipped.push(relativePath)
      continue
    }
    pending.push({ path: filePath, relativePath, size: stat.size, hash })
  }

  console.log(`扫描 ${scanned.length} 个文件：待处理 ${pending.length}，跳过 ${skipped.length}，无效 ${invalid.length}`)
  if (options.dryRun) {
    for (const file of pending) console.log(`[DRY] ${file.relativePath} (${(file.size / 1024 / 1024).toFixed(2)}MB)`)
    if (invalid.length) console.log('无效文件:', invalid)
    return
  }
  if (pending.length === 0) return

  const successes = []
  const failures = []
  await runPool(pending, options.concurrency, async (file, index) => {
    try {
      const result = await uploadFile(file, options, credentials)
      successes.push({ file: file.relativePath, documentId: result.documentId })
      state.files[file.hash] = {
        status: 'success',
        file: file.relativePath,
        documentId: result.documentId,
        importedAt: new Date().toISOString()
      }
      writeState(statePath, state)
      console.log(`[${index + 1}/${pending.length}] 成功 ${file.relativePath}`)
    } catch (error) {
      failures.push({ file: file.relativePath, error: error.message })
      console.error(`[${index + 1}/${pending.length}] 失败 ${file.relativePath}: ${error.message}`)
    }
  })

  console.log(`导入完成：成功 ${successes.length}，失败 ${failures.length}，跳过 ${skipped.length}`)
  if (failures.length > 0) {
    console.error(JSON.stringify({ failures }, null, 2))
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error('[BatchImport]', error.message)
  process.exitCode = 1
})
