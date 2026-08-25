const path = require('path')

const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif'
}

function detectMimeType(filename, fallback) {
  if (!filename) return fallback || 'application/octet-stream'
  const ext = path.extname(filename).toLowerCase()
  return MIME_MAP[ext] || fallback || 'application/octet-stream'
}

function getMimeTypeLabel(mimetype) {
  const labels = {
    'application/pdf': 'PDF文档',
    'application/msword': 'Word文档(DOC)',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word文档(DOCX)',
    'application/vnd.ms-excel': 'Excel表格(XLS)',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel表格(XLSX)',
    'application/vnd.ms-powerpoint': 'PPT演示(PPT)',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPT演示(PPTX)',
    'text/plain': '文本文件(TXT)',
    'text/markdown': 'Markdown(MD)',
    'application/json': 'JSON数据',
    'text/csv': 'CSV表格',
    'text/html': 'HTML网页',
    'image/png': 'PNG图片',
    'image/jpeg': 'JPG图片',
    'image/gif': 'GIF图片'
  }
  return labels[mimetype] || mimetype?.split('/')[1]?.toUpperCase() || '未知类型'
}

module.exports = { detectMimeType, getMimeTypeLabel, MIME_MAP }