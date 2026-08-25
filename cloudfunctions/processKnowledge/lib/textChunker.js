/**
 * 文本分块器
 *
 * 策略：
 *   1. 结构感知优先：识别 Markdown 标题（# ~ ######）作为分块边界
 *   2. 代码块保护：``` ... ``` 整体保留不分切
 *   3. 段落聚合：标题区间内按段落聚合到 chunkSize
 *   4. 单段超长降级：滑动窗口硬切（代码块内部除外）
 *   5. 过滤过短块，减少噪声
 *
 * 适用：个人知识库上传文档后的切片预处理
 */

// 匹配 Markdown 标题行（# ~ ######，行首 1-6 个 #）
const HEADING_RE = /^#{1,6}\s+.+$/
// 匹配代码围栏开始/结束
const FENCE_RE = /^```/

/**
 * 判断是否为 Markdown 标题行
 */
function _isHeading(line) {
  return HEADING_RE.test(line.trim())
}

/**
 * 将长文本切分为多个 chunk
 * @param {string} text 原始文本
 * @param {object} options { chunkSize=500, overlap=100, minChunkSize=50 }
 * @returns {string[]} chunks
 */
function chunkText(text, options = {}) {
  const { chunkSize = 500, overlap = 100, minChunkSize = 50 } = options
  if (!text || typeof text !== 'string') return []

  // 统一换行符 & 去除不间断空格
  const clean = text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim()
  if (!clean) return []

  const lines = clean.split('\n')

  // 阶段 1：按标题 + 代码块边界切分为"语义段"（segments）
  // 每个 segment 是一个语义连续的文本块，内部不再被标题/代码块打断
  const segments = []
  let segBuf = []
  let inFence = false // 是否在代码块内

  for (const line of lines) {
    // 代码围栏检测（在代码块内时不识别标题，避免误判代码注释为标题）
    if (FENCE_RE.test(line.trim())) {
      if (!inFence) {
        // 代码块开始前先结束普通文本，保证代码块成为独立语义段。
        if (segBuf.length > 0 && segBuf.some(item => item.trim())) {
          segments.push(segBuf.join('\n'))
        }
        segBuf = [line]
        inFence = true
      } else {
        segBuf.push(line)
        segments.push(segBuf.join('\n'))
        segBuf = []
        inFence = false
      }
      continue
    }

    // 遇到标题行（非代码块内）：结束当前 segment，标题开启新 segment
    if (!inFence && _isHeading(line) && segBuf.length > 0) {
      segments.push(segBuf.join('\n'))
      segBuf = []
    }

    segBuf.push(line)
  }
  if (segBuf.length > 0) segments.push(segBuf.join('\n'))

  // 阶段 2：对每个语义段按 chunkSize 聚合（含 overlap）
  const chunks = []
  let buffer = ''

  for (const seg of segments) {
    const segTrimmed = seg.trim()
    if (!segTrimmed) continue

    // 代码块段：整体保留，不硬切（避免破坏代码完整性）
    const isCodeSeg = FENCE_RE.test(segTrimmed.split('\n')[0]) || segTrimmed.startsWith('```')

    if (isCodeSeg) {
      // 代码块整体作为一个 chunk
      if (buffer) {
        chunks.push(buffer)
        buffer = ''
      }
      chunks.push(segTrimmed)
      continue
    }

    // 普通段：按段落聚合
    const paragraphs = segTrimmed.split(/\n{1,}/).map(p => p.trim()).filter(Boolean)

    for (const p of paragraphs) {
      // 单段超长：硬切（滑动窗口）
      if (p.length > chunkSize) {
        if (buffer) {
          chunks.push(buffer)
          buffer = ''
        }
        const step = Math.max(chunkSize - overlap, 1)
        for (let i = 0; i < p.length; i += step) {
          chunks.push(p.substring(i, i + chunkSize))
          if (i + chunkSize >= p.length) break
        }
        continue
      }

      // 累加到 chunkSize
      const candidate = buffer ? buffer + '\n' + p : p
      if (candidate.length > chunkSize && buffer) {
        chunks.push(buffer)
        // overlap：保留上一块末尾，保证上下文连续
        buffer = buffer.slice(-overlap) + '\n' + p
      } else {
        buffer = candidate
      }
    }
  }
  if (buffer) chunks.push(buffer)

  // 阶段 3：过滤过短块（代码块除外，代码块即使短也保留）
  return chunks.filter(c => {
    const t = c.trim()
    if (t.length < minChunkSize) {
      // 短代码块保留（可能是有用的代码片段）
      return FENCE_RE.test(t.split('\n')[0])
    }
    return true
  })
}

module.exports = { chunkText }
