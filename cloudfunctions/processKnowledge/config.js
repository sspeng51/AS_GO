/**
 * 云函数配置（自包含）
 *
 * 重要：云函数部署时只上传 processKnowledge/ 目录内的文件，
 * 上级目录的 config/config.js 不会上传到云端！
 * 因此模型配置必须写在本文件中，不要依赖上级目录。
 *
 * 修改模型只需改下方 zhipu.model 一处。
 */

let config = {
  timeouts: {
    chatUpstream: 100000
  },
  zhipu: {
    // 安全：API Key 从云函数环境变量注入，不下发到小程序
    apiKey: (process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY) || '',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    // ============================================================
    // 【云函数模型配置源】修改模型只需改这一行！
    // 可选值：
    //   - glm-5.3（当前主回答模型）
    // ============================================================
    // 保持与小程序配置及流式服务白名单一致。
    model: 'glm-5.3',
    temperature: 0.7,
    maxTokens: 2048,
    // GLM-5.x 混合思考模型专用配置（其他模型自动忽略）
    // GLM-5.3 支持 low / high / max；low 用于控制响应时间。
    thinking: { reasoning_effort: 'low' },
    // 智谱托管知识库 ID（公共知识库），从环境变量注入
    knowledgeId: process.env.ZHIPU_KNOWLEDGE_ID || '',
    // 视觉模型（图片 OCR 用）
    visionModel: process.env.ZHIPU_VISION_MODEL || 'glm-4v-flash',
    embedding: {
      model: 'embedding-3',
      dimensions: 1024,
      batchSize: 10,
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000
    }
  }
}

// Neo4j 云端图谱配置（从环境变量注入，不下发到小程序）
config.neo4j = {
  uri: process.env.NEO4J_URI || '',
  username: process.env.NEO4J_USERNAME || 'neo4j',
  password: process.env.NEO4J_PASSWORD || '',
  database: process.env.NEO4J_DATABASE || 'neo4j'
}

module.exports = config
