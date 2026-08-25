<script setup>
import { ref, onMounted } from 'vue'
import api from '@/api'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(false)
const users = ref([])
const usersLoading = ref(false)
const diagLoading = ref(false)
const collectionsLoading = ref(false)

const systemConfig = ref({
  environment: { envId: '', region: '' },
  zhipu: { model: '', embeddingModel: '', knowledgeId: '', apiKeyConfigured: false },
  cloudFunction: { name: '', version: '', timeout: 0, memorySize: 0 }
})

const diagnosis = ref(null)
const collections = ref([])

onMounted(async () => {
  await refreshAll()
})

async function refreshAll() {
  const tasks = [loadConfig(), loadCollections()]
  if (auth.isAdmin) tasks.push(loadUsers(), loadDiag())
  await Promise.all(tasks)
}

async function loadConfig() {
  loading.value = true
  try {
    const res = await api.get('/system/config')
    if (res.data?.success) {
      systemConfig.value = res.data.config
    }
  } catch (err) {
    ElMessage.error('加载配置失败')
  } finally {
    loading.value = false
  }
}

async function loadUsers() {
  if (!auth.isAdmin) return
  usersLoading.value = true
  try {
    const res = await api.get('/auth/users')
    if (res.data?.success) {
      users.value = res.data.users
    }
  } catch (err) {
    console.warn('加载用户列表失败')
  } finally {
    usersLoading.value = false
  }
}

async function loadDiag() {
  if (!auth.isAdmin) return
  diagLoading.value = true
  try {
    const res = await api.get('/system/cloudbase-diag')
    if (res.data?.success) {
      diagnosis.value = res.data.diagnosis
    }
  } catch (err) {
    console.warn('加载诊断信息失败')
  } finally {
    diagLoading.value = false
  }
}

async function loadCollections() {
  collectionsLoading.value = true
  try {
    const res = await api.get('/system/collections')
    if (res.data?.success) {
      collections.value = res.data.collections
    }
  } catch (err) {
    console.warn('加载集合状态失败')
  } finally {
    collectionsLoading.value = false
  }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-header">
      <h2>⚙️ 系统配置</h2>
      <el-button :icon="'Refresh'" @click="refreshAll">刷新</el-button>
    </div>

    <el-row :gutter="20">
      <!-- 左列：配置信息 -->
      <el-col :span="auth.isAdmin ? 14 : 24">
        <!-- 环境配置 -->
        <el-card shadow="never" style="margin-bottom: 16px;">
          <template #header><span>🌐 环境配置</span></template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="云开发环境ID">{{ systemConfig.environment.envId }}</el-descriptions-item>
            <el-descriptions-item label="区域">{{ systemConfig.environment.region }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 智谱 API 配置 -->
        <el-card shadow="never" style="margin-bottom: 16px;">
          <template #header><span>🤖 智谱 API 配置</span></template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="对话模型">{{ systemConfig.zhipu.model }}</el-descriptions-item>
            <el-descriptions-item label="Embedding 模型">{{ systemConfig.zhipu.embeddingModel }}</el-descriptions-item>
            <el-descriptions-item label="知识库 ID">
              <span v-if="systemConfig.zhipu.knowledgeId && systemConfig.zhipu.knowledgeId !== '未配置'">
                {{ systemConfig.zhipu.knowledgeId }}<span style="color:#909399;font-size:12px;margin-left:8px">(已脱敏)</span>
              </span>
              <el-tag v-else type="danger" size="small">未配置</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="API Key">
              <el-tag :type="systemConfig.zhipu.apiKeyConfigured ? 'success' : 'danger'" size="small">
                {{ systemConfig.zhipu.apiKeyConfigured ? '已配置' : '未配置' }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
          <div class="tip-box">
            智谱 API Key 和知识库 ID 通过云函数环境变量注入（ZHIPU_API_KEY / ZHIPU_KNOWLEDGE_ID），需在云开发控制台配置。
          </div>
        </el-card>

        <!-- 云函数配置 -->
        <el-card shadow="never" style="margin-bottom: 16px;">
          <template #header><span>☁️ 云函数配置</span></template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="函数名称">{{ systemConfig.cloudFunction.name }}</el-descriptions-item>
            <el-descriptions-item label="版本">{{ systemConfig.cloudFunction.version }}</el-descriptions-item>
            <el-descriptions-item label="超时时间">{{ systemConfig.cloudFunction.timeout }} 秒</el-descriptions-item>
            <el-descriptions-item label="内存配额">{{ systemConfig.cloudFunction.memorySize }} MB</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- CloudBase 连接诊断 -->
        <el-card v-if="auth.isAdmin" shadow="never" v-loading="diagLoading" style="margin-bottom: 16px;">
          <template #header><span>🔍 CloudBase 连接诊断</span></template>
          <el-descriptions :column="1" border v-if="diagnosis">
            <el-descriptions-item label="连接状态">
              <el-tag :type="diagnosis.ready ? 'success' : 'danger'" size="small">
                {{ diagnosis.ready ? '正常' : '异常' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="已验证环境">{{ diagnosis.verifiedEnvId || '-' }}</el-descriptions-item>
            <el-descriptions-item label="认证方式">{{ diagnosis.authMethod }}</el-descriptions-item>
            <el-descriptions-item label="SecretId">{{ diagnosis.secretIdPrefix || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="连接测试" v-if="diagnosis.testConnection">
              <el-tag :type="diagnosis.testConnection.success ? 'success' : 'danger'" size="small">
                {{ diagnosis.testConnection.success ? '成功' : '失败' }}
              </el-tag>
              <span style="margin-left:8px;color:#606266;font-size:12px">{{ diagnosis.testConnection.message }}</span>
            </el-descriptions-item>
          </el-descriptions>
          <el-empty v-else description="加载中..." :image-size="40" />
        </el-card>

        <!-- 业务集合状态 -->
        <el-card shadow="never" v-loading="collectionsLoading">
          <template #header><span>📦 业务集合状态</span></template>
          <el-table :data="collections" stripe size="small">
            <el-table-column prop="name" label="集合名" min-width="140" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.exists ? 'success' : 'danger'" size="small">
                  {{ row.exists ? '存在' : '缺失' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="记录数" width="100">
              <template #default="{ row }">{{ row.total ?? '-' }}</template>
            </el-table-column>
            <el-table-column prop="error" label="错误信息" min-width="200" show-overflow-tooltip />
          </el-table>
          <div class="tip-box" v-if="collections.some(c => !c.exists)">
            ⚠️ 部分集合缺失，系统会在启动时自动创建。如仍缺失，请到
            <a href="https://console.cloud.tencent.com/tcb" target="_blank">云开发控制台</a>
            手动创建。
          </div>
        </el-card>
      </el-col>

      <!-- 右列：用户管理 -->
      <el-col v-if="auth.isAdmin" :span="10">
        <el-card shadow="never" v-loading="usersLoading">
          <template #header><span>👥 用户管理</span></template>
          <el-table :data="users" stripe size="small" max-height="600">
            <el-table-column prop="username" label="用户名" width="120" />
            <el-table-column label="角色" width="80">
              <template #default="{ row }">
                <el-tag :type="row.role === 'admin' ? 'danger' : 'info'" size="small">
                  {{ row.role === 'admin' ? '管理员' : '用户' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="nickname" label="昵称" min-width="120" />
          </el-table>
          <el-empty v-if="users.length === 0 && !usersLoading" description="暂无用户" :image-size="60" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.tip-box {
  margin-top: 12px;
  padding: 10px 14px;
  background: #f5f7fa;
  border-left: 3px solid #409eff;
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
  border-radius: 2px;
}
.tip-box a {
  color: #409eff;
  text-decoration: none;
}
</style>
