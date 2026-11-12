<script setup>
import { ref, onMounted } from 'vue'
import api from '@/api'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(false)
const saving = ref(false)
const applyingPreset = ref('')

const config = ref({
  preset: 'balanced',
  zhipu: { useZhipuKb: true, topN: 15, cloudTimeout: 15000 },
  retrieval: { recallMethod: 'mixed', recallRatio: 80, rerankStatus: 0 },
  context: { maxChunks: 10, maxTokens: 2000, minScore: 40, overlap: 200, includeMetadata: true },
  graph: { enabled: true, hybridTimeout: 85000, plannerTimeout: 12000, queryTimeout: 15000, maxHops: 2, maxFacts: 20, contextMaxTokens: 800, schemaCacheTTL: 600000 },
  updatedAt: null,
  updatedBy: ''
})

const presets = [
  { name: 'precise', label: '精确模式', desc: '少召回精简上下文，追求精准匹配', color: '#f56c6c' },
  { name: 'balanced', label: '均衡模式', desc: '默认推荐参数，兼顾精准与召回', color: '#409eff' },
  { name: 'recall', label: '召回模式', desc: '多召回充裕上下文，追求高召回率', color: '#67c23a' }
]

onMounted(async () => {
  await loadConfig()
})

async function loadConfig() {
  loading.value = true
  try {
    const res = await api.get('/rag-config')
    if (res.data?.success) {
      config.value = res.data.config
    }
  } catch (err) {
    ElMessage.error('加载配置失败: ' + (err.response?.data?.error || err.message))
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!auth.isAdmin) {
    ElMessage.warning('当前账号为只读角色，不能修改配置')
    return
  }
  saving.value = true
  try {
    const res = await api.put('/rag-config', config.value)
    if (res.data?.success) {
      config.value = res.data.config
      ElMessage.success('配置已保存，云函数将在 5 分钟内生效（配置缓存刷新）')
    }
  } catch (err) {
    ElMessage.error('保存失败: ' + (err.response?.data?.error || err.message))
  } finally {
    saving.value = false
  }
}

async function applyPreset(name) {
  if (!auth.isAdmin) return
  try {
    await ElMessageBox.confirm(
      `确定应用「${presets.find(p => p.name === name)?.label}」？当前自定义参数将被覆盖。`,
      '应用预设',
      { confirmButtonText: '应用', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }

  applyingPreset.value = name
  try {
    const res = await api.post('/rag-config/preset', { name })
    if (res.data?.success) {
      config.value = res.data.config
      ElMessage.success(`已应用${presets.find(p => p.name === name)?.label}`)
    }
  } catch (err) {
    ElMessage.error('应用预设失败: ' + (err.response?.data?.error || err.message))
  } finally {
    applyingPreset.value = ''
  }
}

function formatTime(t) {
  return t ? dayjs(typeof t === 'string' ? t : t.toISOString ? t.toISOString() : t).format('YYYY-MM-DD HH:mm:ss') : '-'
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-header">
      <h2>检索参数</h2>
      <div>
        <el-button :icon="'Refresh'" @click="loadConfig">重载</el-button>
        <el-button type="primary" :icon="'Check'" :loading="saving" :disabled="!auth.isAdmin" @click="handleSave">保存配置</el-button>
      </div>
    </div>
    <el-alert v-if="!auth.isAdmin" title="当前为只读账号：可以查看配置，但不能保存或应用预设。" type="info" :closable="false" style="margin-bottom:16px" />

    <!-- 预设档 -->
    <el-card shadow="never" style="margin-bottom: 16px;">
      <template #header><span>⚡ 预设档（一键应用）</span></template>
      <div class="preset-row">
        <div
          v-for="p in presets"
          :key="p.name"
          class="preset-card"
          :class="{ active: config.preset === p.name, readonly: !auth.isAdmin }"
          @click="auth.isAdmin && applyPreset(p.name)"
        >
          <div class="preset-label" :style="{ color: p.color }">{{ p.label }}</div>
          <div class="preset-desc">{{ p.desc }}</div>
          <el-button
            v-if="applyingPreset === p.name"
            type="text"
            loading
            size="small"
            style="margin-top: 8px;"
          >应用中...</el-button>
        </div>
      </div>
    </el-card>

    <el-row :gutter="20">
      <!-- 智谱知识库 -->
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>🧠 智谱托管知识库</span></template>
          <el-form label-width="160px" label-position="right" :disabled="!auth.isAdmin">
            <el-form-item label="启用智谱托管">
              <el-switch v-model="config.zhipu.useZhipuKb" />
              <span class="hint">关闭后不检索公共知识库，问答将仅基于模型通识生成</span>
            </el-form-item>
            <el-form-item label="智谱召回数 topN">
              <el-input-number v-model="config.zhipu.topN" :min="1" :max="50" :step="1" />
              <span class="hint">智谱知识库初始召回数量</span>
            </el-form-item>
            <el-form-item label="客户端超时">
              <el-input-number v-model="config.zhipu.cloudTimeout" :min="5000" :max="120000" :step="1000" />
              <span class="hint">ms，小程序端检索超时</span>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <!-- 上下文构建 -->
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>📝 上下文构建</span></template>
          <el-form label-width="180px" label-position="right" :disabled="!auth.isAdmin">
            <el-form-item label="最多引用知识块">
              <el-input-number v-model="config.context.maxChunks" :min="1" :max="20" :step="1" />
              <span class="hint">实际送入模型的最大检索片段数</span>
            </el-form-item>
            <el-form-item label="上下文 Token 预算">
              <el-input-number v-model="config.context.maxTokens" :min="500" :max="8000" :step="500" />
              <span class="hint">约 {{ config.context.maxTokens * 4 }} 个中文字符</span>
            </el-form-item>
            <el-form-item label="最低相关度">
              <el-input-number v-model="config.context.minScore" :min="0" :max="100" :step="5" />
              <span class="hint">低于该分数的片段不会作为有效知识库命中</span>
            </el-form-item>
          </el-form>
          <div class="tip-box">
            控制传给大模型的参考内容长度。预算过大可能超出 token 限制，过小则上下文不足。
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" style="margin-top: 16px;">
      <template #header><span>🕸️ Neo4j 知识图谱检索</span></template>
      <el-form label-width="190px" label-position="right" :disabled="!auth.isAdmin">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="启用图谱检索">
              <el-switch v-model="config.graph.enabled" />
              <span class="hint">知识库检索后，优先使用 glm-5.3-flash 规划只读 Cypher</span>
            </el-form-item>
            <el-form-item label="混合检索总超时">
              <el-input-number v-model="config.graph.hybridTimeout" :min="10000" :max="120000" :step="1000" />
              <span class="hint">ms，小程序等待双路检索的总时间；实际等待不会低于各阶段预算之和</span>
            </el-form-item>
            <el-form-item label="Cypher 规划超时">
              <el-input-number v-model="config.graph.plannerTimeout" :min="3000" :max="30000" :step="1000" />
              <span class="hint">ms，glm-5.3-flash 独立超时</span>
            </el-form-item>
            <el-form-item label="Neo4j 查询超时">
              <el-input-number v-model="config.graph.queryTimeout" :min="1000" :max="30000" :step="1000" />
              <span class="hint">ms，只读事务执行上限；低于 15 秒时超时会用新会话按 15 秒重试一次</span>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最大关系跳数">
              <el-input-number v-model="config.graph.maxHops" :min="1" :max="4" :step="1" />
            </el-form-item>
            <el-form-item label="最多图谱事实">
              <el-input-number v-model="config.graph.maxFacts" :min="1" :max="20" :step="1" />
              <span class="hint">超过时仅保留前 20 条实体关系</span>
            </el-form-item>
            <el-form-item label="图谱上下文 Token">
              <el-input-number v-model="config.graph.contextMaxTokens" :min="100" :max="4000" :step="100" />
            </el-form-item>
            <el-form-item label="Schema 缓存时长">
              <el-input-number v-model="config.graph.schemaCacheTTL" :min="60000" :max="3600000" :step="60000" />
              <span class="hint">ms，默认缓存 10 分钟</span>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <div class="tip-box">Cypher 会在服务端执行参数化、只读关键字、跳数与 LIMIT 校验；生产 Neo4j 账号仍应配置为 reader 权限。</div>
    </el-card>

    <!-- 检索策略（智谱 retrieval API 参数） -->
    <el-card shadow="never" style="margin-top: 16px;">
      <template #header><span>🎯 检索策略（智谱 retrieval API 参数）</span></template>
      <el-form label-width="200px" label-position="right" :disabled="!auth.isAdmin">
        <el-form-item label="召回方式 recall_method">
          <el-radio-group v-model="config.retrieval.recallMethod">
            <el-radio-button label="mixed">混合召回（向量+文本）</el-radio-button>
            <el-radio-button label="embedding">向量召回</el-radio-button>
            <el-radio-button label="keyword">关键词召回</el-radio-button>
          </el-radio-group>
          <span class="hint">mixed 质量最佳，vector 语义匹配，text 关键词匹配</span>
        </el-form-item>
        <el-form-item label="向量召回占比 recall_ratio">
          <el-slider v-model="config.retrieval.recallRatio" :min="0" :max="100" :step="5" show-input style="max-width: 500px;" />
          <span class="hint">仅 mixed 模式生效，向量召回结果占比(%)</span>
        </el-form-item>
        <el-form-item label="重排开关 rerank_status">
          <el-radio-group v-model="config.retrieval.rerankStatus">
            <el-radio-button :label="0">关闭重排</el-radio-button>
            <el-radio-button :label="1">开启重排</el-radio-button>
          </el-radio-group>
          <span class="hint">开启后智谱对召回结果二次排序，质量更高但耗时增加</span>
        </el-form-item>
      </el-form>
      <div class="tip-box">
        保存后云函数将在配置缓存刷新时读取新值（最多 5 分钟）。测试记录中的实际配置快照用于核对是否生效。
      </div>
    </el-card>

    <!-- 更新信息 -->
    <el-card shadow="never" style="margin-top: 16px;">
      <div class="update-info">
        <span>当前预设: <el-tag size="small" :type="config.preset === 'precise' ? 'danger' : config.preset === 'recall' ? 'success' : 'primary'">{{ presets.find(p => p.name === config.preset)?.label || config.preset || '自定义' }}</el-tag></span>
        <span>最后更新: {{ formatTime(config.updatedAt) }}</span>
        <span>更新人: {{ config.updatedBy || '-' }}</span>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.preset-row {
  display: flex;
  gap: 16px;
}
.preset-card {
  flex: 1;
  padding: 16px;
  border: 2px solid #ebeef5;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  text-align: center;
}
.preset-card:hover {
  border-color: #409eff;
  background: #f0f7ff;
}
.preset-card.active {
  border-color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2);
}
.preset-card.readonly {
  cursor: default;
  opacity: 0.8;
}
.preset-label {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 6px;
}
.preset-desc {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.hint {
  margin-left: 12px;
  font-size: 12px;
  color: #909399;
}
.tip-box {
  margin-top: 8px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-left: 3px solid #409eff;
  font-size: 12px;
  color: #606266;
  line-height: 1.6;
  border-radius: 2px;
}
.update-info {
  display: flex;
  gap: 32px;
  font-size: 13px;
  color: #606266;
  align-items: center;
}
</style>
