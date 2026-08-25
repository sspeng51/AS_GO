const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const projectRoot = __dirname
const configPath = path.join(projectRoot, 'cloudbaserc.json')
const cliPath = path.join(
  projectRoot,
  'node_modules',
  '@cloudbase',
  'cli',
  'dist',
  'standalone',
  'cli.js'
)
const supportedFunctions = [
  'processKnowledge',
  'wechatLogin',
  'feedback',
  'mediaProcess',
  'chatConversation',
  'userConsistencyCheck'
]

function printUsage() {
  console.log(`
用法:
  npm run deploy:cloud -- --check
  npm run deploy:cloud -- processKnowledge
  npm run deploy:cloud -- processKnowledge wechatLogin --force
  npm run deploy:cloud -- --all --force

说明:
  --check  只检查本地部署配置，不连接云端
  --all    部署 cloudbaserc.json 中列出的全部云函数
  --force  覆盖云端同名函数，适合非交互式更新
`)
}

function parseArgs(argv) {
  const options = {
    check: false,
    all: false,
    force: false,
    names: []
  }

  for (const arg of argv) {
    if (arg === '--check') options.check = true
    else if (arg === '--all') options.all = true
    else if (arg === '--force') options.force = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('-')) throw new Error(`未知参数: ${arg}`)
    else options.names.push(...arg.split(',').map(item => item.trim()).filter(Boolean))
  }

  return options
}

function loadAndValidateConfig() {
  if (!fs.existsSync(cliPath)) {
    throw new Error('缺少 @cloudbase/cli，请先在项目根目录执行 npm install')
  }
  if (!fs.existsSync(configPath)) {
    throw new Error('缺少 cloudbaserc.json')
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const envId = process.env.CLOUDBASE_ENV_ID || config.envId
  if (!envId) {
    throw new Error('未配置云环境 ID：请设置 CLOUDBASE_ENV_ID 或 cloudbaserc.json 的 envId')
  }

  const configuredNames = new Set((config.functions || []).map(item => item.name))
  for (const name of supportedFunctions) {
    if (!configuredNames.has(name)) {
      throw new Error(`cloudbaserc.json 未配置云函数: ${name}`)
    }

    const functionDir = path.join(projectRoot, config.functionRoot || 'cloudfunctions', name)
    for (const secretFile of ['.env', '.env.local', 'private.key']) {
      if (fs.existsSync(path.join(functionDir, secretFile))) {
        throw new Error(`云函数 ${name} 目录包含禁止部署的敏感文件: ${secretFile}`)
      }
    }
    for (const requiredFile of ['index.js', 'package.json']) {
      if (!fs.existsSync(path.join(functionDir, requiredFile))) {
        throw new Error(`云函数 ${name} 缺少 ${requiredFile}`)
      }
    }

    const sourceBytes = directorySize(functionDir, new Set(['node_modules', 'dist', 'build']))
    if (sourceBytes > 10 * 1024 * 1024) {
      throw new Error(`云函数 ${name} 源码包超过 10MB（不含依赖）`)
    }
  }

  return { envId }
}

function directorySize(directory, ignored) {
  let total = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    total += entry.isDirectory() ? directorySize(fullPath, ignored) : fs.statSync(fullPath).size
  }
  return total
}

function deployFunction(name, envId, force) {
  const args = [
    cliPath,
    '--env-id',
    envId,
    '--config-file',
    configPath,
    'fn',
    'deploy',
    name
  ]
  if (force) args.push('--force')

  console.log(`\n[deploy] ${name}`)
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  })

  if (result.error) throw result.error
  return result.status === 0
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printUsage()
    return
  }

  const { envId } = loadAndValidateConfig()
  if (options.check) {
    console.log(`部署配置检查通过：${supportedFunctions.length} 个云函数，环境 ${envId}`)
    return
  }

  if (options.all && options.names.length) {
    throw new Error('--all 不能与具体云函数名称同时使用')
  }

  const names = options.all ? supportedFunctions : [...new Set(options.names)]
  if (names.length === 0) {
    printUsage()
    throw new Error('请指定要部署的云函数，或使用 --all')
  }

  for (const name of names) {
    if (!supportedFunctions.includes(name)) {
      throw new Error(`未知云函数: ${name}`)
    }
  }

  console.log(`准备部署到环境 ${envId}: ${names.join(', ')}`)
  for (const name of names) {
    if (!deployFunction(name, envId, options.force)) {
      throw new Error(`${name} 部署失败，已停止后续部署`)
    }
  }
  console.log(`\n部署完成：${names.length} 个云函数`)
}

try {
  main()
} catch (error) {
  console.error(`部署脚本错误：${error.message}`)
  process.exitCode = 1
}
