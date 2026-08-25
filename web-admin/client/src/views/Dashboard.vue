<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2>📊 仪表盘</h2>
    </div>

    <el-card shadow="never" style="margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="font-size: 48px;">📚</div>
        <div>
          <h3 style="margin: 0 0 8px 0;">欢迎使用 砷智答知识库管理后台</h3>
          <p style="margin: 0; color: #606266;">本系统使用智谱托管知识库，请在左侧菜单进行功能管理。</p>
        </div>
      </div>
    </el-card>

    <el-row :gutter="20">
      <el-col :span="10">
        <el-card shadow="never">
          <template #header>
            <span>⚡ 快捷操作</span>
          </template>

          <div style="display: flex; flex-direction: column; gap: 12px;">
            <el-button type="primary" style="width: 100%;" @click="router.push('/rag-tuning')">
              <el-icon><Operation /></el-icon> RAG 调优
            </el-button>
            <el-button type="success" style="width: 100%;" @click="router.push('/conversations')">
              <el-icon><ChatDotRound /></el-icon> 用户对话记录
            </el-button>
            <el-button type="warning" style="width: 100%;" @click="router.push('/feedback')">
              <el-icon><ChatLineSquare /></el-icon> 用户反馈管理
            </el-button>
            <el-button style="width: 100%;" @click="router.push('/system')">
              <el-icon><Setting /></el-icon> 系统配置
            </el-button>
          </div>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card shadow="never">
          <template #header>
            <span>💡 系统信息</span>
          </template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="环境ID">{{ 'cloud1-6gbzplmt4a3dc5b5' }}</el-descriptions-item>
            <el-descriptions-item label="Embedding模型">embedding-3</el-descriptions-item>
            <el-descriptions-item label="搜索模式">智谱托管知识库</el-descriptions-item>
            <el-descriptions-item label="后端地址">http://localhost:3000</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
