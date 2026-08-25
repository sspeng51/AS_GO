/**
 * 个人知识库客户端管理器
 *
 * 封装与云函数 processKnowledge 的 personal.* 系列交互：
 *   - 文件选择与上传（微信聊天文件 / 本地图片）
 *   - 文档列表 / 删除 / 统计
 *   - 向量检索
 *   - 智能问答（含历史）
 *
 * 上传流程：wx.cloud.uploadFile → 云存储 fileID → personal.upload（解析/分块/嵌入/入库）
 */

const CLOUD_FUNCTION = 'processKnowledge'

// 文件类型支持的扩展名白名单（前端校验，减少无效上传）
const userInfoManager = require('./userInfoManager')

const SUPPORTED_EXTS = [
  'txt', 'md', 'markdown', 'csv', 'json', 'log', 'tsv',   // 纯文本
  'pdf',                                                    // PDF
  'docx',                                                   // DOCX（doc 旧格式不支持）
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'                // 图片（云函数走 GLM-4V OCR 入库）
]

// 预设分类
const CATEGORIES = ['技术文档', '学习笔记', '工作资料', '个人收藏', '其他']

class PersonalKB {
  constructor() {
    this.cloudTimeout = 120000 // 上传/问答可能较慢
  }

  // ============ 底层云函数调用 ============

  _call(action, data = {}) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: CLOUD_FUNCTION,
        data: { action, data },
        success: (res) => resolve(res.result),
        fail: (err) => reject(err)
      })
    })
  }

  // ============ 文件选择 ============

  /**
   * 选择微信聊天文件 / 收藏文件
   * @param {number} count 最多选择数量
   * @returns {Promise<Array<{path, name, size}>>}
   */
  chooseMessageFile(count = 1) {
    return new Promise((resolve, reject) => {
      wx.chooseMessageFile({
        count,
        type: 'file',
        success: (res) => {
          const files = (res.tempFiles || []).map(f => ({
            path: f.path,
            name: f.name,
            size: f.size
          }))
          resolve(files)
        },
        fail: (err) => reject(err)
      })
    })
  }

  /**
   * 选择本地图片（相册/拍照）
   * @returns {Promise<Array<{path, name, size, type}>>}
   */
  chooseImage() {
    return new Promise((resolve, reject) => {
      wx.chooseMedia({
        count: 9,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const files = (res.tempFiles || []).map((f, i) => ({
            path: f.tempFilePath,
            name: `image_${Date.now()}_${i}.${this._extFromPath(f.tempFilePath) || 'png'}`,
            size: f.size,
            type: 'image'
          }))
          resolve(files)
        },
        fail: (err) => reject(err)
      })
    })
  }

  _extFromPath(path) {
    if (!path) return ''
    const idx = path.lastIndexOf('.')
    return idx >= 0 ? path.substring(idx + 1).toLowerCase() : ''
  }

  /**
   * 校验文件扩展名是否支持
   */
  isSupported(fileName) {
    const ext = this._extFromPath(fileName)
    return SUPPORTED_EXTS.includes(ext)
  }

  // ============ 上传 ============

  /**
   * 上传单个文件到个人知识库
   * @param {object} param { filePath, fileName, category, tags, onProgress }
   * @returns {Promise<{success, document, warning?}>}
   */
  async upload({ filePath, fileName, category = '其他', tags = [], onProgress }) {
    if (!filePath) throw new Error('filePath 不能为空')
    if (!this.isSupported(fileName)) {
      throw new Error(`不支持的文件类型：${fileName}（支持 ${SUPPORTED_EXTS.join(' / ')}）`)
    }

    // 1. 上传到云存储
    const cloudPath = this._buildCloudPath(fileName)
    const fileID = await new Promise((resolve, reject) => {
      const task = wx.cloud.uploadFile({
        cloudPath,
        filePath,
        success: (res) => resolve(res.fileID),
        fail: (err) => reject(err)
      })
      if (onProgress && task && task.onProgressUpdate) {
        task.onProgressUpdate((p) => onProgress(p.progress || 0))
      }
    })

    // 2. 调用云函数解析+嵌入+入库
    const result = await this._call('personal.upload', {
      fileID,
      fileName,
      category,
      tags: Array.isArray(tags) ? tags : []
    })

    if (!result || !result.success) {
      throw new Error((result && result.error) || '上传处理失败')
    }
    return result
  }

  _buildCloudPath(fileName) {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const rand = Math.random().toString(36).substring(2, 8)
    // 防止特殊字符，仅保留字母数字点
    const safeName = (fileName || 'file').replace(/[^\w.\-]/g, '_')
    const info = userInfoManager.getUserInfo()
    const owner = String(info.userId || info.openid || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_')
    if (!owner) throw new Error('用户身份信息缺失，请重新登录')
    return `personal-kb/${owner}/${y}${m}${d}_${Date.now()}_${rand}_${safeName}`
  }

  // ============ 文档管理 ============

  async listDocuments({ page = 1, size = 20, category, tag, tags, tagMode } = {}) {
    const res = await this._call('personal.list', { page, size, category, tag, tags, tagMode })
    if (!res || !res.success) throw new Error((res && res.error) || '获取列表失败')
    return res
  }

  async deleteDocument(documentId) {
    const res = await this._call('personal.delete', { documentId })
    if (!res || !res.success) throw new Error((res && res.error) || '删除失败')
    return true
  }

  /**
   * 文档详情（含切片预览分页）
   * @returns {Promise<{document, chunks, chunkPage, chunkSize, totalChunks, hasMoreChunks}>}
   */
  async getDocDetail({ documentId, chunkPage = 1, chunkSize = 5 } = {}) {
    const res = await this._call('personal.doc.detail', { documentId, chunkPage, chunkSize })
    if (!res || !res.success) throw new Error((res && res.error) || '获取详情失败')
    return res
  }

  /**
   * 重新解析文档（重新下载/抽取/分块/嵌入/替换切片）
   */
  async reprocessDocument(documentId) {
    const res = await this._call('personal.doc.reprocess', { documentId })
    if (!res || !res.success) throw new Error((res && res.error) || '重新解析失败')
    return res
  }

  async getStats() {
    const res = await this._call('personal.stats', {})
    if (!res || !res.success) throw new Error((res && res.error) || '获取统计失败')
    return res.stats
  }

  // ============ 检索与问答 ============

  async search({ query, topK = 5 }) {
    const res = await this._call('personal.search', { query, topK })
    if (!res || !res.success) throw new Error((res && res.error) || '检索失败')
    return res
  }

  /**
   * 智能问答
   * @param {object} param { question, history, sessionId }
   * @returns {Promise<{answer, sources, sessionId, historyId, duration}>}
   */
  async ask({ question, history = [], sessionId }) {
    const res = await this._call('personal.ask', { question, history, sessionId })
    if (!res || !res.success) throw new Error((res && res.error) || '问答失败')
    return res
  }

  // ============ 问答历史 ============

  async listHistory({ page = 1, size = 20, sessionId } = {}) {
    const res = await this._call('personal.history.list', { page, size, sessionId })
    if (!res || !res.success) throw new Error((res && res.error) || '获取历史失败')
    return res
  }

  /**
   * 会话列表（按 sessionId 分组）
   * @returns {Promise<{sessions: Array<{sessionId, title, count, lastTime, lastQuestion}>, total}>}
   */
  async listSessions() {
    const res = await this._call('personal.history.sessions', {})
    if (!res || !res.success) throw new Error((res && res.error) || '获取会话列表失败')
    return res
  }

  async deleteHistory(historyId) {
    const res = await this._call('personal.history.delete', { historyId })
    if (!res || !res.success) throw new Error((res && res.error) || '删除历史失败')
    return true
  }

  /**
   * 删除整个会话（级联删除该 session 下全部历史）
   */
  async deleteSession(sessionId) {
    const res = await this._call('personal.session.delete', { sessionId })
    if (!res || !res.success) throw new Error((res && res.error) || '删除会话失败')
    return res.removed || 0
  }
}

// 导出类与常量
PersonalKB.SUPPORTED_EXTS = SUPPORTED_EXTS
PersonalKB.CATEGORIES = CATEGORIES

module.exports = PersonalKB
