<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import RetrievalConfig from './RetrievalConfig.vue'
import TuningWorkspace from './TuningWorkspace.vue'
import QuickRetrieval from './QuickRetrieval.vue'
import AnswerComparison from './AnswerComparison.vue'
import EmbeddingComparison from './EmbeddingComparison.vue'
import FactualComparison from './FactualComparison.vue'
import EvidenceChainExperiment from './EvidenceChainExperiment.vue'
import GraphRelevance from './GraphRelevance.vue'
const route = useRoute()
const router = useRouter()
const active = computed({
  get: () => route.query.tab === 'generation' ? 'generation' : 'retrieval',
  set: tab => router.replace({ query: { ...route.query, tab } })
})
</script>

<template>
  <div class="page-container rag-page">
    <div class="page-header"><div><h2>RAG 调优</h2><p>先验证检索证据，再优化回答质量。</p></div><el-tag effect="plain">调优工作台</el-tag></div>
    <el-tabs v-model="active" class="main-tabs">
      <el-tab-pane label="检索调优" name="retrieval">
        <el-tabs type="border-card">
          <el-tab-pane label="检索内容 · 知识库评估"><QuickRetrieval /></el-tab-pane>
          <el-tab-pane label="图谱检索相关性评估" lazy><GraphRelevance /></el-tab-pane>
          <el-tab-pane label="证据链完整性实验" lazy><EvidenceChainExperiment /></el-tab-pane>
          <el-tab-pane label="五组回答对比" lazy><AnswerComparison /></el-tab-pane>
          <el-tab-pane label="五组向量相似度实验" lazy><EmbeddingComparison /></el-tab-pane>
          <el-tab-pane label="五组四指标自动实验" lazy><FactualComparison /></el-tab-pane>
          <el-tab-pane label="检索方法 · 多检索器" lazy>
            <el-alert title="检索方法调优" type="info" :closable="false" description="当前支持向量、关键词、混合召回及重排参数配置；高级测试支持知识库、图谱与混合检索。保存参数会更新公共配置，多检索器自动批量对比尚未接入。" />
            <RetrievalConfig />
          </el-tab-pane>
          <el-tab-pane label="嵌入模型" lazy>
            <el-empty description="嵌入模型评估待接入">
              <p>当前公共知识库由智谱托管，后台尚未提供切换嵌入模型和重建索引的接口。</p>
              <p>可先为不同模型分别准备知识库，在「知识库评估」中使用同一批问题对比。</p>
            </el-empty>
          </el-tab-pane>
          <el-tab-pane label="测试集与历史复核" lazy><TuningWorkspace mode="retrieval" /></el-tab-pane>
        </el-tabs>
      </el-tab-pane>
      <el-tab-pane label="生成调优" name="generation" lazy><TuningWorkspace mode="generation" /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.rag-page { min-height: auto; }
.page-header p { margin: 8px 0 0; font-size: 14px; color: #788495; }
.main-tabs :deep(> .el-tabs__header .el-tabs__item) { font-size: 17px; padding-bottom: 8px; height: 48px; }
</style>
