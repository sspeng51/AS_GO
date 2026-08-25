const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const ignoredDirs = new Set(['node_modules', 'miniprogram_npm', 'dist', 'build', '.git', '.idea'])
const allowedExampleValues = /^(your-|replace-|example|changeme|change-me|test-|xxx|\s*$)/i
const findings = []

function inspectFile(file) {
  const relative = path.relative(root, file).replace(/\\/g, '/')
  const base = path.basename(file)
  if (/^\.env(\.|$)/.test(base) && !base.endsWith('.example')) return
  if (!/\.(js|json|ya?ml|md|example|txt)$/i.test(base)) return
  if (relative === 'CODE_WIKI.md' || relative === 'RESEARCH_REPORT.md') return

  const text = fs.readFileSync(file, 'utf8')
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    findings.push(`${relative}: 包含私钥内容`)
  }
  if (/\bAKID[A-Za-z0-9]{20,}\b/.test(text)) {
    findings.push(`${relative}: 疑似包含腾讯云 SecretId`)
  }
  if (/\b[a-f0-9]{32}\.[A-Za-z0-9_-]{12,}\b/i.test(text)) {
    findings.push(`${relative}: 疑似包含模型 API Key`)
  }

  const assignment = /\b(?:JWT_SECRET|SECRET_KEY|API_KEY|APPSECRET|WECHAT_SECRET|STREAM_SHARED_SECRET)\s*[:=]\s*["']([^"']+)["']/gi
  let match
  while ((match = assignment.exec(text))) {
    const value = match[1].trim()
    if (value.length >= 12 && !allowedExampleValues.test(value) && !/process\.env|\$\{|\|\|/.test(value)) {
      findings.push(`${relative}: 疑似硬编码敏感配置`)
    }
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile()) inspectFile(full)
  }
}

walk(root)

const tracked = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
if (tracked.status === 0) {
  const forbiddenTracked = tracked.stdout.split(/\r?\n/).filter(file =>
    /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example') ||
    /(^|\/)(?:private\.key|.*credentials.*\.json|.*secrets.*\.json)$/i.test(file)
  )
  forbiddenTracked.forEach(file => findings.push(`${file}: 敏感配置文件不应被 Git 跟踪`))
}

if (findings.length) {
  console.error(`敏感信息检查失败：${findings.length} 项`)
  findings.forEach(item => console.error(`- ${item}`))
  process.exit(1)
}
console.log('敏感信息检查通过：源码中未发现疑似真实凭据。')
