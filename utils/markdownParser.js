/**
 * 轻量级 Markdown → HTML 解析器（微信小程序 rich-text 兼容）
 *
 * 设计目标：
 *  - 让 AI 回答中的 ### 标题、**加粗**、`代码`、列表、引用等不再以原始符号呈现
 *  - 输出 HTML 字符串交给 <rich-text> 渲染，得到类 ChatGPT 的排版效果
 *  - 不引入第三方库，纯原生 JS，体积小
 *  - 颜色策略：普通文本颜色继承父容器（深色模式自动跟随），仅代码块/引用用半透明背景
 *
 * 支持语法：
 *  - 标题：# / ## / ### / #### / ##### / ######
 *  - 加粗：**text** 或 __text__
 *  - 斜体：*text* 或 _text_
 *  - 行内代码：`code`
 *  - 代码块：```lang ... ```
 *  - 无序列表：- / * / + 开头
 *  - 有序列表：1. / 2. 开头
 *  - 引用：> 开头
 *  - 分隔线：--- / ***
 *  - 链接：[text](url)
 *  - 段落与换行
 */

// HTML 转义，避免 < > & 把 rich-text 解析搞坏
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// 行内格式：加粗 / 斜体 / 行内代码 / 链接
// 注意要先处理代码（避免代码内的 * 被误判），再做加粗和斜体
function renderInline(text) {
  // 1. 行内代码 `code` —— 内容不二次解析
  let parts = []
  let lastIdx = 0
  const codeRe = /`([^`\n]+)`/g
  let m
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ type: 'text', value: text.slice(lastIdx, m.index) })
    parts.push({ type: 'code', value: m[1] })
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) parts.push({ type: 'text', value: text.slice(lastIdx) })
  codeRe.lastIndex = 0

  // 2. 对非 code 片段处理加粗/斜体/链接
  const out = parts.map(p => {
    if (p.type === 'code') {
      return `<code style="background-color:rgba(128,128,128,0.15);padding:2px 6px;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:0.9em;color:inherit;">${escapeHtml(p.value)}</code>`
    }
    let s = escapeHtml(p.value)
    // 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" style="color:#2563eb;text-decoration:underline;">$1</a>')
    // 加粗：**text** 或 __text__
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    // 斜体：*text* 或 _text_（避免和加粗冲突，要求两侧紧贴非空白）
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
    return s
  }).join('')

  return out
}

// 主解析函数
function markdownToHtml(md) {
  if (!md || typeof md !== 'string') return ''

  // 统一换行符
  const src = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = src.split('\n')

  const html = []
  let i = 0

  // 列表缓冲（连续的列表项合并为 <ul>/<ol>）
  let listBuf = []         // {type:'ul'|'ol', items:[]}
  function flushList() {
    if (listBuf.length === 0) return
    const type = listBuf[0].type
    const items = listBuf.map(it =>
      `<li style="margin:6px 0;line-height:1.7;">${renderInline(it.text)}</li>`
    ).join('')
    const tag = type === 'ol' ? 'ol' : 'ul'
    const style = tag === 'ol'
      ? 'padding-left:28px;margin:8px 0;'
      : 'padding-left:24px;margin:8px 0;list-style:disc;'
    html.push(`<${tag} style="${style}">${items}</${tag}>`)
    listBuf = []
  }

  // 引用缓冲（连续 > 行合并）
  let quoteBuf = []
  function flushQuote() {
    if (quoteBuf.length === 0) return
    const inner = quoteBuf.map(renderInline).join('<br/>')
    html.push(
      `<blockquote style="margin:10px 0;padding:8px 14px;border-left:4px solid #6366f1;background:rgba(99,102,241,0.08);border-radius:0 6px 6px 0;color:inherit;">${inner}</blockquote>`
    )
    quoteBuf = []
  }

  // 段落缓冲（连续普通行合并为 <p>）
  let paraBuf = []
  function flushPara() {
    if (paraBuf.length === 0) return
    const text = paraBuf.join(' ')
    html.push(`<p style="margin:8px 0;line-height:1.7;">${renderInline(text)}</p>`)
    paraBuf = []
  }

  function flushAll() {
    flushPara()
    flushList()
    flushQuote()
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 空行：刷新所有缓冲
    if (trimmed === '') {
      flushAll()
      i++
      continue
    }

    // 代码块 ```
    const fenceMatch = trimmed.match(/^```(.*)$/)
    if (fenceMatch) {
      flushAll()
      const codeLines = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i])
        i++
      }
      // 跳过结束 ```
      if (i < lines.length) i++
      const code = escapeHtml(codeLines.join('\n'))
      html.push(
        `<pre style="margin:10px 0;padding:12px 14px;background-color:rgba(128,128,128,0.12);border-radius:8px;overflow-x:auto;font-family:Menlo,Consolas,monospace;font-size:0.88em;line-height:1.6;"><code style="font-family:inherit;">${code}</code></pre>`
      )
      continue
    }

    // 标题 # ~ ######
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headerMatch) {
      flushAll()
      const level = headerMatch[1].length
      const text = headerMatch[2]
      const sizes = ['1.6em', '1.45em', '1.3em', '1.18em', '1.08em', '1em']
      const marginTop = level <= 2 ? '14px' : '10px'
      const marginBottom = '6px'
      html.push(
        `<h${level} style="font-size:${sizes[level - 1]};font-weight:700;margin:${marginTop} 0 ${marginBottom};line-height:1.4;color:inherit;">${renderInline(text)}</h${level}>`
      )
      i++
      continue
    }

    // 分隔线 --- / ***
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll()
      html.push(`<hr style="border:none;border-top:1px solid rgba(128,128,128,0.3);margin:12px 0;"/>`)
      i++
      continue
    }

    // 引用 >
    if (/^>\s?/.test(trimmed)) {
      flushPara()
      flushList()
      quoteBuf.push(trimmed.replace(/^>\s?/, ''))
      i++
      continue
    } else {
      // 引用结束
      if (quoteBuf.length > 0) flushQuote()
    }

    // 无序列表 - / * / +
    const ulMatch = trimmed.match(/^([-*+])\s+(.*)$/)
    if (ulMatch) {
      flushPara()
      flushQuote()
      // 若上一个 list 项是 ol，先 flush
      if (listBuf.length > 0 && listBuf[0].type !== 'ul') flushList()
      listBuf.push({ type: 'ul', text: ulMatch[2] })
      i++
      continue
    }

    // 有序列表 1. / 2.
    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/)
    if (olMatch) {
      flushPara()
      flushQuote()
      if (listBuf.length > 0 && listBuf[0].type !== 'ol') flushList()
      listBuf.push({ type: 'ol', text: olMatch[2] })
      i++
      continue
    }

    // 普通行：累加到段落
    if (listBuf.length > 0) flushList()
    if (quoteBuf.length > 0) flushQuote()
    paraBuf.push(trimmed)
    i++
  }

  // 收尾
  flushAll()

  return html.join('')
}

module.exports = {
  markdownToHtml,
  renderInline,
  escapeHtml
}
