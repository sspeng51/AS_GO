const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const ignoredDirectories = new Set(['node_modules', 'dist', 'build', '.git', '.idea'])
const files = []

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(fullPath)
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath)
  }
}

walk(root)

const failures = []
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    failures.push({
      file: path.relative(root, file),
      output: (result.stderr || result.stdout || '').trim()
    })
  }
}

if (failures.length > 0) {
  console.error(`语法检查失败：${failures.length}/${files.length}`)
  for (const failure of failures) {
    console.error(`\n${failure.file}\n${failure.output}`)
  }
  process.exit(1)
}

console.log(`语法检查通过：${files.length} 个 JavaScript 文件。`)
