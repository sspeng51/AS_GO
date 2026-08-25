<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { Search, RefreshRight, ChatDotRound, User, Cpu, DocumentCopy, Delete, InfoFilled } from '@element-plus/icons-vue'
import api from '@/api'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const filters = reactive({
  userId: '',
  dateFrom: '',
  dateTo: ''
})

const userList = ref([])
const userLoading = ref(false)

const sessions = ref([])
const sessionsLoading = ref(false)
const sessionPagination = reactive({ page: 1, pageSize: 20, total: 0, totalPages: 0 })

const messages = ref([])
const messagesLoading = ref(false)
const messagePagination = reactive({ page: 1, pageSize: 50, total: 0, totalPages: 0 })
const currentSession = ref(null)
const showMessageDialog = ref(false)

// 统计概览
const stats = reactive({
  userCount: 0,
  sessionCount: 0,
  messageCount: 0
})
const statsLoading = ref(false)

async function loadUsers() {
  userLoading.value = true
  try {
    const res = await api.get('/conversations/users')
    if (res.data?.success) {
      userList.value = res.data.users || []
      stats.userCount = res.data.total || 0
    }
  } catch (err) {
    console.error('[Conversations] 加载用户列表失败:', err.message || err)
    ElMessage.warning('加载用户列表失败，请检查服务状态')
  }
  finally { userLoading.value = false }
}

async function searchSessions() {
  sessionsLoading.value = true
  try {
    const params = { page: sessionPagination.page, pageSize: sessionPagination.pageSize }
    if (filters.userId) params.userId = filters.userId
    if (filters.dateFrom) params.dateFrom = filters.dateFrom
    if (filters.dateTo) params.dateTo = filters.dateTo

    const res = await api.get('/conversations/sessions', { params })
    if (res.data?.success) {
      sessions.value = res.data.sessions || []
      sessionPagination.total = res.data.pagination?.total || 0
      sessionPagination.totalPages = res.data.pagination?.totalPages || 0
      stats.messageCount = sessions.value.reduce((s, x) => s + (x.messageCount || 0), 0)
      stats.sessionCount = sessionPagination.total
    } else {
      ElMessage.warning('查询会话列表返回异常')
    }
  } catch (err) {
    console.error('[Conversations] 查询会话列表失败:', err.message || err)
    ElMessage.error('查询会话列表失败: ' + (err.response?.data?.error || err.message || '网络错误'))
  }
  finally { sessionsLoading.value = false }
}

function viewMessages(session) {
  console.log('[Conversation] 点击查看对话, session:', JSON.stringify(session))
  currentSession.value = session
  messagePagination.page = 1
  showMessageDialog.value = true
  loadMessages()
}

async function loadMessages() {
  if (!currentSession.value) return
  const sid = currentSession.value.sessionId || currentSession.value._id
  const recordId = currentSession.value.recordId || ''
  if (!sid && !recordId) { ElMessage.warning('该会话缺少标识信息'); return }
  messagesLoading.value = true
  messages.value = []
  try {
    const params = {
      userId: currentSession.value.userId || undefined,
      sessionId: recordId ? undefined : sid,
      recordId: recordId || undefined,
      page: messagePagination.page,
      pageSize: messagePagination.pageSize
    }
    if (filters.dateFrom) params.dateFrom = filters.dateFrom
    if (filters.dateTo) params.dateTo = filters.dateTo

    const res = await api.get('/conversations/messages', { params })
    if (res.data?.success) {
      messages.value = res.data.messages || []
      messagePagination.total = res.data.pagination?.total || 0
      messagePagination.totalPages = res.data.pagination?.totalPages || 0
      if (messages.value.length === 0) ElMessage.warning('该筛选范围内没有对话内容')
    } else {
      throw new Error(res.data?.error || '服务端未返回对话内容')
    }
  } catch (err) {
    console.error('[Conversations] 加载消息失败:', err.message || err)
    ElMessage.error('加载消息失败: ' + (err.response?.data?.error || err.message || '网络错误'))
  }
  finally { messagesLoading.value = false }
}

function handleMessagePageChange(page) { messagePagination.page = page; loadMessages() }
function handleSessionPageChange(page) { sessionPagination.page = page; searchSessions() }

function resetFilters() {
  filters.userId = ''
  filters.dateFrom = ''
  filters.dateTo = ''
  sessionPagination.page = 1
  searchSessions()
}

// 删除会话
async function deleteSession(session) {
  if (!auth.isAdmin) {
    ElMessage.warning('当前账号为只读角色，不能删除会话')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要删除用户 ${session.userId} 的该会话吗？\n共 ${session.messageCount || 0} 条消息将被永久删除。`,
      '确认删除',
      { confirmButtonText: '确定删除', cancelButtonText: '取消', type: 'warning' }
    )
    const res = await api.delete('/conversations/sessions', { data: { userId: session.userId, sessionId: session.sessionId } })
    if (res.data?.success) {
      ElMessage.success(res.data.message || '删除成功')
      searchSessions()
      if (showMessageDialog.value && currentSession.value?.sessionId === session.sessionId) {
        showMessageDialog.value = false
        messages.value = []
      }
    }
  } catch (err) {
    if (err !== 'cancel') ElMessage.error('删除失败')
  }
}

// 复制到剪贴板
function copyText(text, label = '内容') {
  navigator.clipboard.writeText(text).then(() => ElMessage.success(`${label}已复制`)).catch(() => ElMessage.error('复制失败'))
}

// 格式化时间
function formatTime(timestamp) {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 相对时间
function relativeTime(timestamp) {
  if (!timestamp) return '-'
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return formatTime(timestamp)
}

// 截断ID
function truncateId(id, len = 12) {
  if (!id) return '-'
  const s = String(id).trim()
  if (s.length <= len) return s || '-'
  return s.substring(0, len) + '...'
}

function safeUserId(row) {
  return row.userId && row.userId.trim() ? row.userId.trim() : (row.sessionId || '未知用户')
}

// 获取用户显示名称
function getUserDisplayName(row) {
  if (row.nickName && row.nickName !== '微信用户') return row.nickName
  return truncateId(safeUserId(row), 12)
}

// 获取头像URL（兜底转换 cloud:// 为 https://）
function getAvatarUrl(row) {
  const url = row.avatarUrl || ''
  if (!url) return ''
  if (url.startsWith('cloud://')) {
    const m = url.match(/^cloud:\/\/([^.]+)\.(.+?)\/(.+)$/)
    return m ? `https://${m[1]}.tcb.qcloud.la/${m[3]}` : ''
  }
  if (url.startsWith('wxfile://')) return ''
  return url
}

// 从消息 metadata 中提取头像（过滤 cloud:// 等浏览器不可用的 URL，并尝试兜底转换）
function getMsgAvatarUrl(msg) {
  const meta = msg.metadata || {}
  const url = meta.avatarUrl || ''
  if (!url) return ''
  if (url.startsWith('cloud://')) {
    // 兜底：cloud://env-id.xxx/path → https://env-id.tcb.qcloud.la/path
    const m = url.match(/^cloud:\/\/([^.]+)\.(.+?)\/(.+)$/)
    return m ? `https://${m[1]}.tcb.qcloud.la/${m[3]}` : ''
  }
  if (url.startsWith('wxfile://')) return ''
  return url
}

// 从消息 metadata 中提取用户昵称
function getMsgNickName(msg) {
  const meta = msg.metadata || {}
  return meta.nickName || ''
}

onMounted(() => { loadUsers(); searchSessions() })
</script>

<template>
  <div class="page-container">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2><el-icon><ChatDotRound /></el-icon> 用户对话记录</h2>
      <span class="header-desc">查看和管理所有用户与AI助手的完整交互过程</span>
    </div>

    <!-- 统计概览 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon" style="background:#ecf5ff;color:#409eff"><el-icon :size="22"><User /></el-icon></div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.userCount }}</div>
          <div class="stat-label">活跃用户</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#f0f9eb;color:#67c23a"><el-icon :size="22"><ChatDotRound /></el-icon></div>
        <div class="stat-info">
          <div class="stat-value">{{ sessionPagination.total }}</div>
          <div class="stat-label">会话数量</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#fdf6ec;color:#e6a23c"><el-icon :size="22"><InfoFilled /></el-icon></div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.messageCount }}</div>
          <div class="stat-label">消息总数</div>
        </div>
      </div>
    </div>

    <!-- 筛选区域 -->
    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="filters" class="filter-form">
        <el-form-item label="用户ID">
          <el-select v-model="filters.userId" placeholder="选择或输入搜索" clearable filterable :loading="userLoading" style="width:280px;">
            <el-option v-for="u in userList" :key="u.userId" :label="u.nickName || u.userId" :value="u.userId">
              <div style="display:flex;align-items:center;gap:8px">
                <el-avatar :size="24" :src="getAvatarUrl(u)" v-if="getAvatarUrl(u)">
                  <el-icon :size="14"><User /></el-icon>
                </el-avatar>
                <el-avatar :size="24" style="background:#409eff;" v-else>
                  <el-icon :size="14"><User /></el-icon>
                </el-avatar>
                <div style="display:flex;flex-direction:column;overflow:hidden">
                  <span style="font-size:13px;font-weight:500;color:#303133;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ getUserDisplayName(u) }}</span>
                  <span style="font-size:11px;color:#909399;">{{ truncateId(u.userId, 16) }}</span>
                </div>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="日期范围">
          <el-date-picker v-model="filters.dateFrom" type="date" placeholder="开始日期" value-format="YYYY-MM-DD" clearable style="width:150px;" />
          <span class="date-sep">至</span>
          <el-date-picker v-model="filters.dateTo" type="date" placeholder="结束日期" value-format="YYYY-MM-DD" clearable style="width:150px;" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="searchSessions"><el-icon><Search /></el-icon> 查询</el-button>
          <el-button @click="resetFilters"><el-icon><RefreshRight /></el-icon> 重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 会话列表 -->
    <el-card shadow="never" class="table-card">
      <template #header>
        <div class="card-header-row">
          <span>会话列表</span>
          <span class="card-hint" v-if="sessionPagination.total > 0">共 {{ sessionPagination.total }} 个会话</span>
        </div>
      </template>

      <!-- 空状态 -->
      <div v-if="!sessionsLoading && sessions.length === 0" class="empty-state">
        <img src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=flat%20illustration%20of%20empty%20chat%20conversation%20list,%20minimalist,%20soft%20blue%20and%20white%20colors,%20clean%20design,%20no%20text&image_size=square" alt="" class="empty-img" />
        <p class="empty-title">暂无对话记录</p>
        <p class="empty-desc">当用户在小程序中与AI助手对话后，记录将自动显示在这里</p>
      </div>

      <el-table v-else :data="sessions" v-loading="sessionsLoading" stripe row-class-name="session-row" style="width:100%">
        <el-table-column label="用户" width="220">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="36" :src="getAvatarUrl(row)" v-if="getAvatarUrl(row)">
                <el-icon :size="18"><User /></el-icon>
              </el-avatar>
              <el-avatar :size="36" style="background:#409eff;" v-else>
                <el-icon :size="18"><User /></el-icon>
              </el-avatar>
              <div class="user-text">
                <div class="user-name" :title="getUserDisplayName(row)">{{ getUserDisplayName(row) }}</div>
                <div class="user-id-sub" :title="safeUserId(row)">{{ truncateId(safeUserId(row), 16) }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="sessionId" label="会话ID" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <code class="id-code">{{ truncateId(row.sessionId, 18) }}</code>
            <el-button size="small" link type="primary" @click.stop="copyText(row.sessionId,'会话ID')" style="margin-left:4px;padding:0">
              <el-icon :size="13"><DocumentCopy /></el-icon>
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="消息数" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" round :type="row.messageCount > 50 ? 'danger' : row.messageCount > 10 ? 'warning' : ''">{{ row.messageCount || 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后消息预览" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="last-msg-preview">{{ row.lastMessage || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" size="small" plain @click="viewMessages(row)">
              <el-icon><ChatDotRound /></el-icon> 查看对话
            </el-button>
            <el-popconfirm v-if="auth.isAdmin" title="确认删除此会话？" @confirm="deleteSession(row)" confirm-button-text="删除" cancel-button-text="取消">
              <template #reference>
                <el-button type="danger" size="small" plain text>
                  <el-icon><Delete /></el-icon>
                </el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap" v-if="sessionPagination.totalPages > 1">
        <el-pagination background layout="prev,pager,next,total,jumper" :total="sessionPagination.total"
          :page-size="sessionPagination.pageSize" :current-page="sessionPagination.page" @current-change="handleSessionPageChange" />
      </div>
    </el-card>

    <!-- 对话详情弹窗（聊天风格） -->
    <el-dialog v-model="showMessageDialog" width="800px" top="4vh" destroy-on-close class="chat-dialog">
      <template #header>
        <div class="dialog-header">
          <div class="dialog-title-row">
            <el-icon :size="18" color="#409eff"><ChatDotRound /></el-icon>
            <span>对话详情</span>
          </div>
          <div class="dialog-meta" v-if="currentSession">
            <el-avatar :size="20" :src="getAvatarUrl(currentSession)" v-if="getAvatarUrl(currentSession)" style="vertical-align:middle;margin-right:2px">
              <el-icon :size="12"><User /></el-icon>
            </el-avatar>
            <span class="meta-tag"><User /> {{ getUserDisplayName(currentSession) }}</span>
            <span class="meta-sep">|</span>
            <span class="meta-tag">{{ messagePagination.total }} 条消息</span>
          </div>
        </div>
      </template>

      <!-- 会话信息栏 -->
      <div class="session-bar" v-if="currentSession">
        <div class="bar-item"><label>首次对话</label><value>{{ formatTime(currentSession.firstMessageTime) }}</value></div>
        <div class="bar-item"><label>最近对话</label><value>{{ formatTime(currentSession.lastMessageTime) }}</value></div>
        <div class="bar-item bar-right">
          <el-date-picker v-model="filters.dateFrom" type="date" placeholder="开始" value-format="YYYY-MM-DD" size="small" clearable style="width:130px" />
          <span style="margin:0 4px;color:#999">-</span>
          <el-date-picker v-model="filters.dateTo" type="date" placeholder="结束" value-format="YYYY-MM-DD" size="small" clearable style="width:130px" />
          <el-button size="small" type="primary" @click="loadMessages" style="margin-left:6px">过滤</el-button>
        </div>
      </div>

      <!-- 聊天气泡区域 -->
      <div class="chat-area" v-loading="messagesLoading">
        <div v-for="(msg, idx) in messages" :key="msg.id" class="chat-bubble-wrap" :class="msg.direction">
          <div class="bubble-avatar">
            <el-avatar :size="36" :src="getMsgAvatarUrl(msg)" v-if="msg.direction==='user' && getMsgAvatarUrl(msg)">
              <el-icon :size="18"><User /></el-icon>
            </el-avatar>
            <el-avatar :size="36" :style="{background: msg.direction==='user' ? '#409eff' : '#67c23a'}" v-else>
              <el-icon :size="18"><component :is="msg.direction==='user' ? User : Cpu" /></el-icon>
            </el-avatar>
          </div>
          <div class="bubble-body">
            <div class="bubble-name-time">
              <span class="bubble-name">{{ msg.direction === 'user' ? (getMsgNickName(msg) || '用户') : 'AI 助手' }}</span>
              <span class="bubble-time">{{ formatTime(msg.timestamp) }}</span>
              <el-tag v-if="msg.messageType !== 'text'" size="small" :type="{image:'success',voice:'warning',file:'info'}[msg.messageType]" effect="plain" style="margin-left:6px;height:18px;line-height:16px;font-size:10px">
                {{ {text:'文本',image:'图片',voice:'语音',file:'文件'}[msg.messageType] }}
              </el-tag>
            </div>
            <div class="bubble-content">{{ msg.content }}</div>
          </div>
        </div>

        <el-empty v-if="messages.length === 0 && !messagesLoading" description="暂无消息" :image-size="80" />
      </div>

      <div class="pagination-wrap" v-if="messagePagination.totalPages > 1">
        <el-pagination background layout="prev,pager,next,total" :total="messagePagination.total"
          :page-size="messagePagination.pageSize" :current-page="messagePagination.page" @current-change="handleMessagePageChange" small />
      </div>

      <template #footer>
        <el-button @click="showMessageDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-container { max-width:1400px }

/* 标题 */
.page-header { margin-bottom:20px }
.page-header h2 { margin:0;font-size:22px;font-weight:700;display:flex;align-items:center;gap:8px }
.header-desc { font-size:13px;color:#909399;margin-top:4px;display:block }

/* 统计卡片 */
.stats-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin-bottom:16px }
.stat-card { display:flex; align-items:center; gap:14px; padding:20px 24px; border-radius:12px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.06); transition:transform .2s }
.stat-card:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.08) }
.stat-icon { width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0 }
.stat-value { font-size:28px;font-weight:700;color:#303133;line-height:1.2 }
.stat-label { font-size:13px;color:#909399;margin-top:2px }

/* 筛选 */
.filter-card { margin-bottom:16px }
.filter-form .el-form-item { margin-bottom:8px }
.date-sep { margin:0 6px;color:#c0c4cc }

/* 表格 */
.table-card { margin-bottom:16px }
.card-header-row { display:flex;justify-content:space-between;align-items:center }
.card-hint { font-size:13px;color:#909399;font-weight:400 }

/* 空状态 */
.empty-state { text-align:center;padding:48px 20px }
.empty-img { width:180px;height:180px;object-fit:contain;margin-bottom:16px;opacity:.85 }
.empty-title { font-size:16px;color:#303133;font-weight:600;margin-bottom:8px }
.empty-desc { font-size:13px;color:#909399;max-width:360px;margin:0 auto }

/* 用户单元格 */
.user-cell { display:flex;align-items:center;gap:10px }
.user-text { overflow:hidden;display:flex;flex-direction:column;gap:2px }
.user-name { font-size:14px;font-weight:600;color:#303133;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
.user-id-sub { font-size:11px;color:#909399;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'SF Mono','Consolas',monospace }

/* ID代码样式 */
.id-code { font-family:'SF Mono','Consolas',monospace;font-size:12px;background:#f5f7fa;padding:2px 6px;border-radius:4px;color:#606266 }

/* 最后消息预览 */
.last-msg-preview { font-size:13px;color:#606266 }

/* 分页 */
.pagination-wrap { display:flex;justify-content:center;margin-top:16px;padding-bottom:4px }

/* ===== 聊天弹窗 ===== */
.chat-dialog :deep(.el-dialog__body) { padding:0 20px 16px }
.dialog-header { padding-bottom:0 }
.dialog-title-row { display:flex;align-items:center;gap:6px;font-size:16px;font-weight:600 }
.dialog-meta { display:flex;align-items:center;gap:6px;margin-top:4px;font-size:12px;color:#909399 }
.meta-tag { display:inline-flex;align-items:center;gap:3px }
.meta-sep { color:#dcdfe6 }

/* 会话信息栏 */
.session-bar { display:flex;align-items:center;gap:24px;padding:12px 16px;background:#fafbfc;border-radius:8px;margin-bottom:12px;flex-wrap:wrap }
.bar-item { display:flex;align-items:center;gap:6px;font-size:12px }
.bar-item label { color:#909399;white-space:nowrap }
.bar-item value { color:#303133;font-weight:500 }
.bar-right { margin-left:auto }

/* 聊天区域 */
.chat-area { max-height:520px;overflow-y:auto;padding:8px 4px;scroll-behavior:smooth }
.chat-area::-webkit-scrollbar { width:5px }
.chat-area::-webkit-scrollbar-thumb { background:#dcdfe6;border-radius:3px }

/* 气泡布局 */
.chat-bubble-wrap { display:flex;gap:10px;margin-bottom:18px;padding:4px 0 }
.chat-bubble-wrap.ai { flex-direction:row }
.chat-bubble-wrap.user { flex-direction:row-reverse }

.bubble-avatar { flex-shrink:0 }
.bubble-body { max-width:72%;min-width:0 }

.bubble-name-time { display:flex;align-items:center;gap:6px;margin-bottom:4px }
.chat-bubble-wrap.user .bubble-name-time { justify-content:flex-end }
.bubble-name { font-size:12px;font-weight:600;color:#303133 }
.bubble-time { font-size:11px;color:#c0c4cc }

/* 气泡内容 */
.bubble-content { padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.65;word-break:break-word;white-space:pre-wrap;position:relative }
.chat-bubble-wrap.user .bubble-content { background:#409eff;color:#fff;border-bottom-right-radius:4px }
.chat-bubble-wrap.ai .bubble-content { background:#f4f4f5;color:#303133;border-bottom-left-radius:4px;border:1px solid #e4e7ed }

/* 行hover效果 */
:deep(.session-row:hover td) { background-color:#ecf5ff !important }
</style>
