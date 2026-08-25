/**
 * 文件文本抽取
 *
 * 支持：
 *   - txt/md/markdown/csv/json/log：直接 UTF-8 读取
 *   - pdf：pdf-parse
 *   - docx：mammoth
 *   - 图片（png/jpg/jpeg/gif/bmp/webp）：调用智谱 GLM-4V 视觉模型做 OCR / 描述
 * 不支持（返回空文本 + 说明）：
 *   - doc 旧格式（mammoth 仅支持 docx）
 *   - 其他二进制
 *
 * 注意：pdf-parse / mammoth / https 均为按需引入，避免未安装时整体崩溃
 *
 * extractText 签名兼容旧调用：
 *   extractText(buffer, ext)
 *   extractText(buffer, ext, { apiKey, visionModel, baseUrl })
 */

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']
// 图片 OCR 体积上限：超过则跳过视觉模型调用（避免超长 base64 撑爆请求）
const IMAGE_OCR_MAX_BYTES = 5 * 1024 * 1024  // 5MB

async function extractText(buffer, ext, options = {}) {
  const e = (ext || '').toLowerCase().replace(/^\./, '')

  // 纯文本类
  if (['txt', 'md', 'markdown', 'csv', 'json', 'log', 'tsv'].includes(e)) {
    return { text: buffer.toString('utf8'), method: 'plain' }
  }

  // PDF
  if (e === 'pdf') {
    try {
      const pdfParse = require('pdf-parse')
      const data = await pdfParse(buffer)
      return { text: data.text || '', method: 'pdf-parse' }
    } catch (err) {
      return { text: '', method: 'pdf-parse-failed', note: 'PDF 解析失败: ' + err.message }
    }
  }

  // DOCX
  if (e === 'docx') {
    try {
      const mammoth = require('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return { text: result.value || '', method: 'mammoth' }
    } catch (err) {
      return { text: '', method: 'mammoth-failed', note: 'DOCX 解析失败: ' + err.message }
    }
  }

  // doc 旧格式
  if (e === 'doc') {
    return { text: '', method: 'unsupported', note: '不支持 .doc 旧格式，请转换为 .docx 或 PDF' }
  }

  // 图片：调用视觉模型 OCR
  if (IMAGE_EXTS.includes(e)) {
    return await _extractImageTextViaVision(buffer, e, options)
  }

  // 其他：尝试 utf8 兜底
  try {
    const text = buffer.toString('utf8')
    // 简单判断是否含大量乱码字符（替代字符），若多是二进制则放弃
    const replacementCount = (text.match(/\uFFFD/g) || []).length
    if (replacementCount > text.length * 0.05) {
      return { text: '', method: 'binary', note: '二进制文件不支持文本抽取' }
    }
    return { text, method: 'fallback-utf8' }
  } catch (err) {
    return { text: '', method: 'unsupported', note: err.message }
  }
}

/**
 * 调用智谱 GLM-4V 视觉模型对图片做 OCR + 简要描述
 *   失败时返回空文本 + note，不阻断主流程
 */
async function _extractImageTextViaVision(buffer, ext, options) {
  const apiKey = options && options.apiKey
  if (!apiKey) {
    return { text: '', method: 'image', note: '图片未配置 API Key，跳过 OCR' }
  }
  if (!buffer || buffer.length === 0) {
    return { text: '', method: 'image', note: '图片为空' }
  }
  if (buffer.length > IMAGE_OCR_MAX_BYTES) {
    return {
      text: '',
      method: 'image',
      note: `图片体积 ${(buffer.length / 1024 / 1024).toFixed(1)}MB 超过 OCR 上限 ${IMAGE_OCR_MAX_BYTES / 1024 / 1024}MB，已跳过`
    }
  }

  const model = (options && options.visionModel) || 'glm-4v-flash'
  const baseUrl = (options && options.baseUrl) || 'https://open.bigmodel.cn/api/paas/v4'

  // mime 类型
  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp'
  }
  const mime = mimeMap[ext] || 'image/jpeg'
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`

  const requestBody = {
    model,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: '请提取这张图片中的所有可见文字（OCR），保持原文格式；若图片为图表/示意图，请简要描述其内容。仅返回提取/描述的文字，不要附加说明。'
        },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }],
    temperature: 0.1,
    // glm-4v-flash 的 max_tokens 上限为 1024；超过会导致服务端返回 HTTP 400。
    max_tokens: 1024
  }

  try {
    const https = require('https')
    const text = await new Promise((resolve, reject) => {
      const postData = JSON.stringify(requestBody)
      const url = new URL(baseUrl + '/chat/completions')
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 45000
      }, (res) => {
        let body = ''
        res.on('data', chunk => { body += chunk })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`视觉模型 HTTP ${res.statusCode}: ${body.substring(0, 200)}`))
            return
          }
          try {
            const parsed = JSON.parse(body)
            const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content
            resolve(content || '')
          } catch (e) {
            reject(new Error('视觉模型响应解析失败: ' + e.message))
          }
        })
      })
      req.on('error', err => reject(err))
      req.on('timeout', () => { req.destroy(); reject(new Error('视觉模型请求超时')) })
      req.write(postData)
      req.end()
    })

    if (!text || !text.trim()) {
      return { text: '', method: 'vision-empty', note: '视觉模型未返回有效文字' }
    }
    return { text, method: 'vision-' + model }
  } catch (err) {
    return {
      text: '',
      method: 'vision-failed',
      note: '图片 OCR 失败: ' + (err.message || '').substring(0, 200)
    }
  }
}

/**
 * 根据文件名获取扩展名（小写、无点）
 */
function getExt(fileName) {
  if (!fileName) return ''
  const idx = fileName.lastIndexOf('.')
  return idx >= 0 ? fileName.substring(idx + 1).toLowerCase() : ''
}

/**
 * 根据扩展名返回文件类型分组（前端图标用）
 */
function getFileType(ext) {
  const e = (ext || '').toLowerCase().replace(/^\./, '')
  if (['txt', 'md', 'markdown', 'log', 'tsv'].includes(e)) return 'text'
  if (['pdf'].includes(e)) return 'pdf'
  if (['doc', 'docx'].includes(e)) return 'doc'
  if (['csv', 'json'].includes(e)) return 'data'
  if (IMAGE_EXTS.includes(e)) return 'image'
  return 'other'
}

module.exports = { extractText, getExt, getFileType }
