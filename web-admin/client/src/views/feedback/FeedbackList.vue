<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, RefreshRight, User } from '@element-plus/icons-vue'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// 状态
const loading = ref(false)
const items = ref([])
const stats = reactive({ pending: 0, resolved: 0, closed: 0, total: 0, avgScore: 0, ratedCount: 0 })
const filter = reactive({ status: '', category: '', keyword: '', dateFrom: '', dateTo: '', page: 1, pageSize: 20 })
const total = ref(0)
const detailVisible = ref(false)
const currentItem = ref(null)
const adminNote = ref('')

// 状态标签配置
const statusMap = {
  pending: { text: '待处理', type: 'warning' },
  resolved: { text: '已处理', type: 'success' },
  closed: { text: '已关闭', type: 'info' }
}
const categoryMap = {
  general: '通用反馈',
  bug: 'Bug反馈',
  feature: '功能建议',
  rating: '评价反馈',
  other: '其他'
}

// 获取用户显示名称
function getUserDisplayName(row) {
  if (row.nickName && row.nickName !== '微信用户') return row.nickName
  if (!row.userId) return '匿名用户'
  return row.userId.length > 12 ? row.userId.slice(0, 12) + '...' : row.userId
}

// 获取安全的头像 URL（过滤 cloud:// 等浏览器不可加载的协议）
function getSafeAvatarUrl(row) {
  const url = (row && row.avatarUrl) || ''
  if (!url || url.startsWith('cloud://') || url.startsWith('wxfile://')) return ''
  return url
}

// 评分对应标签类型：高 分绿、中分默认、低分警告/危险
function scoreTagType(score) {
  if (score >= 9) return 'success'
  if (score >= 7) return ''
  if (score >= 5) return 'warning'
  return 'danger'
}

const totalPages = computed(() => Math.ceil(total.value / filter.pageSize))

onMounted(() => {
  fetchStats()
  fetchList()
})

async function fetchStats() {
  try {
    const { data } = await api.get('/feedback/stats')
    if (data.success) Object.assign(stats, data.stats)
  } catch {}
}

async function fetchList() {
  loading.value = true
  try {
    const params = { page: filter.page, pageSize: filter.pageSize }
    if (filter.status) params.status = filter.status
    if (filter.category) params.category = filter.category
    if (filter.keyword) params.keyword = filter.keyword
    if (filter.dateFrom) params.dateFrom = filter.dateFrom
    if (filter.dateTo) params.dateTo = filter.dateTo

    const { data } = await api.get('/feedback/list', { params })
    if (data.success) {
      items.value = data.items
      total.value = data.pagination.total
    }
  } catch (err) {
    ElMessage.error('加载失败: ' + (err.response?.data?.error || err.message))
  } finally {
    loading.value = false
  }
}

function onFilterChange() {
  filter.page = 1
  fetchList()
}

function resetFilters() {
  filter.status = ''
  filter.category = ''
  filter.keyword = ''
  filter.dateFrom = ''
  filter.dateTo = ''
  filter.page = 1
  fetchList()
}

function onPageChange(p) {
  filter.page = p
  fetchList()
}

function showDetail(item) {
  currentItem.value = item
  adminNote.value = item.adminNote || ''
  detailVisible.value = true
}

async function updateStatus(item, newStatus) {
  if (!auth.isAdmin) return
  try {
    await api.patch(`/feedback/${item.feedbackId}`, { status: newStatus })
    ElMessage.success(`已标记为${statusMap[newStatus].text}`)
    fetchList()
    fetchStats()
  } catch (err) {
    ElMessage.error('更新失败')
  }
}

async function saveAdminNote() {
  if (!auth.isAdmin) return
  if (!currentItem.value) return
  try {
    await api.patch(`/feedback/${currentItem.value.feedbackId}`, { adminNote: adminNote.value })
    ElMessage.success('备注已保存')
    currentItem.value.adminNote = adminNote.value
    detailVisible.value = false
    fetchList()
  } catch (err) {
    ElMessage.error('保存失败')
  }
}

async function deleteFeedback(item) {
  if (!auth.isAdmin) return
  try {
    await ElMessageBox.confirm('确定要删除这条反馈吗？', '确认删除', { type: 'warning' })
    await api.delete(`/feedback/${item.feedbackId}`)
    ElMessage.success('已删除')
    fetchList()
    fetchStats()
  } catch {}
}

function formatTime(t) {
  if (!t) return '-'
  const d = new Date(t)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="feedback-page">
    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stats-row">
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card stat-total">
          <div class="stat-num">{{ stats.total }}</div>
          <div class="stat-label">全部反馈</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card stat-pending">
          <div class="stat-num">{{ stats.pending }}</div>
          <div class="stat-label">待处理</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card stat-resolved">
          <div class="stat-num">{{ stats.resolved }}</div>
          <div class="stat-label">已处理</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card stat-closed">
          <div class="stat-num">{{ stats.closed }}</div>
          <div class="stat-label">已关闭</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 评分统计卡片 -->
    <el-row :gutter="16" class="stats-row">
      <el-col :span="24">
        <el-card shadow="hover" class="stat-card stat-score">
          <div class="score-summary">
            <div class="score-avg">
              <span class="score-num">{{ stats.avgScore || '—' }}</span>
              <span class="score-unit">/ 10</span>
            </div>
            <div class="score-meta">
              <div class="stat-label">AI 回答平均评分</div>
              <div class="score-count">{{ stats.ratedCount || 0 }} 人参与评分</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 筛选 -->
    <el-card shadow="never" class="filter-card">
      <div class="filter-bar">
        <el-input v-model="filter.keyword" placeholder="搜索反馈内容..." clearable @clear="onFilterChange" @keyup.enter="onFilterChange" style="width: 220px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="filter.category" placeholder="全部分类" clearable @change="onFilterChange" style="width: 130px">
          <el-option label="通用反馈" value="general" />
          <el-option label="Bug反馈" value="bug" />
          <el-option label="功能建议" value="feature" />
          <el-option label="评价反馈" value="rating" />
          <el-option label="其他" value="other" />
        </el-select>
        <el-select v-model="filter.status" placeholder="全部状态" clearable @change="onFilterChange" style="width: 130px">
          <el-option label="待处理" value="pending" />
          <el-option label="已处理" value="resolved" />
          <el-option label="已关闭" value="closed" />
        </el-select>
        <el-date-picker v-model="filter.dateFrom" type="date" placeholder="开始日期" value-format="YYYY-MM-DD" clearable @change="onFilterChange" style="width: 140px" />
        <span style="color:#c0c4cc">至</span>
        <el-date-picker v-model="filter.dateTo" type="date" placeholder="结束日期" value-format="YYYY-MM-DD" clearable @change="onFilterChange" style="width: 140px" />
        <el-button @click="fetchList"><el-icon><RefreshRight /></el-icon> 刷新</el-button>
        <el-button @click="resetFilters" type="danger" plain size="small">重置</el-button>
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card shadow="never" class="list-card">
      <el-table :data="items" v-loading="loading" stripe style="width: 100%" empty-text="暂无反馈记录">
        <el-table-column label="用户" width="200">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="32" :src="getSafeAvatarUrl(row)" v-if="getSafeAvatarUrl(row)">
                <el-icon :size="16"><User /></el-icon>
              </el-avatar>
              <el-avatar :size="32" style="background:#409eff;" v-else>
                <el-icon :size="16"><User /></el-icon>
              </el-avatar>
              <div class="user-cell-text">
                <div class="user-cell-name">{{ getUserDisplayName(row) }}</div>
                <div class="user-cell-id" :title="row.userId">{{ row.userId ? (row.userId.length > 14 ? row.userId.slice(0, 14) + '...' : row.userId) : '匿名' }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="反馈内容" min-width="280">
          <template #default="{ row }">
            <div class="content-cell" @click="showDetail(row)">
              <el-tag size="small" :type="statusMap[row.status]?.type" style="margin-right: 8px">
                {{ statusMap[row.status]?.text || row.status }}
              </el-tag>
              <span>{{ row.content?.substring(0, 60) }}{{ row.content?.length > 60 ? '...' : '' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="分类" width="100">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ categoryMap[row.category] || row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="AI评分" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.score > 0" :type="scoreTagType(row.score)" size="small">{{ row.score }}分</el-tag>
            <span v-else style="color:#c0c4cc">-</span>
          </template>
        </el-table-column>
        <el-table-column label="联系方式" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.contact || '-' }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="160">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="showDetail(row)">详情</el-button>
            <el-button v-if="auth.isAdmin && row.status === 'pending'" size="small" type="success" link @click="updateStatus(row, 'resolved')">
              标记已处理
            </el-button>
            <el-button v-if="auth.isAdmin && row.status === 'resolved'" size="small" type="info" link @click="updateStatus(row, 'closed')">
              关闭
            </el-button>
            <el-button v-if="auth.isAdmin" size="small" type="danger" link @click="deleteFeedback(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap" v-if="totalPages > 1">
        <el-pagination
          v-model:current-page="filter.page"
          :page-size="filter.pageSize"
          :total="total"
          layout="prev, pager, next"
          @current-change="onPageChange"
        />
      </div>
    </el-card>

    <!-- 详情弹窗 -->
    <el-dialog v-model="detailVisible" title="反馈详情" width="600px" destroy-on-close>
      <template v-if="currentItem">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="用户">
            <div style="display:flex;align-items:center;gap:8px">
              <el-avatar :size="24" :src="getSafeAvatarUrl(currentItem)" v-if="getSafeAvatarUrl(currentItem)"><el-icon :size="12"><User /></el-icon></el-avatar>
              <el-avatar :size="24" style="background:#409eff;" v-else><el-icon :size="12"><User /></el-icon></el-avatar>
              <span>{{ getUserDisplayName(currentItem) }}</span>
            </div>
          </el-descriptions-item>
          <el-descriptions-item label="用户ID">{{ currentItem.userId || '匿名' }}</el-descriptions-item>
          <el-descriptions-item label="分类">
            <el-tag size="small" type="info">{{ categoryMap[currentItem.category] || currentItem.category }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusMap[currentItem.status]?.type">{{ statusMap[currentItem.status]?.text }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="AI 评分">
            <el-tag v-if="currentItem.score > 0" :type="scoreTagType(currentItem.score)">{{ currentItem.score }} 分</el-tag>
            <span v-else style="color:#909399">未评分</span>
          </el-descriptions-item>
          <el-descriptions-item label="联系方式">{{ currentItem.contact || '-' }}</el-descriptions-item>
          <el-descriptions-item label="提交时间" :span="2">{{ formatTime(currentItem.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="反馈内容" :span="2">
            <div class="detail-content">{{ currentItem.content }}</div>
          </el-descriptions-item>
        </el-descriptions>

        <div class="note-section">
          <div class="note-label">管理员备注</div>
          <el-input
            v-model="adminNote"
            type="textarea"
            :rows="3"
            placeholder="添加备注..."
            maxlength="500"
            show-word-limit
            :disabled="!auth.isAdmin"
          />
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">取消</el-button>
        <el-button v-if="auth.isAdmin" type="primary" @click="saveAdminNote">保存备注</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.feedback-page {
  max-width: 1400px;
}

.stats-row {
  margin-bottom: 16px;
}

.stat-card {
  text-align: center;
  cursor: default;
}

.stat-num {
  font-size: 32px;
  font-weight: 700;
  color: #303133;
}

.stat-label {
  font-size: 13px;
  color: #909399;
  margin-top: 4px;
}

.stat-total { border-top: 3px solid #409eff; }
.stat-pending { border-top: 3px solid #e6a23c; }
.stat-resolved { border-top: 3px solid #67c23a; }
.stat-closed { border-top: 3px solid #909399; }
.stat-score { border-top: 3px solid #f56c6c; }

.score-summary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 8px 0;
}

.score-avg {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.score-num {
  font-size: 44px;
  font-weight: 700;
  color: #f56c6c;
  line-height: 1;
}

.score-unit {
  font-size: 16px;
  color: #909399;
}

.score-meta {
  text-align: left;
}

.score-count {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.filter-card {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.content-cell {
  cursor: pointer;
  display: flex;
  align-items: center;
}

.content-cell:hover {
  color: #409eff;
}

.detail-content {
  white-space: pre-wrap;
  line-height: 1.8;
  color: #303133;
}

.note-section {
  margin-top: 20px;
}

.note-label {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.pagination-wrap {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

/* 用户列样式 */
.user-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-cell-text {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-cell-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-cell-id {
  font-size: 11px;
  color: #909399;
  font-family: 'SF Mono', 'Consolas', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
