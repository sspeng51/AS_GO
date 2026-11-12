const zhipuApiKey = typeof process !== 'undefined'
  ? (process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY || '')
  : ''

module.exports = {
  stream: {
    // 部署流式 Web 服务并配置合法域名后填写；留空时自动使用云函数模式。
    serverUrl: ''
  },

  timeouts: {
    cloudFunction: 115000,
    streamRequest: 110000
  },

  zhipu: {
    // 安全提示：API Key 不放在前端包中，由云函数/后台通过环境变量 ZHIPU_API_KEY 或 BIGMODEL_API_KEY 注入密钥
    apiKey: zhipuApiKey,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    // ============================================================
    // 【小程序默认模型】云函数部署包有独立配置；测试会校验两者保持一致。
    // 可选值：
    //   - glm-5.3（当前主回答模型）
    // 
    // ============================================================
    // 保持与已部署云函数及流式服务白名单一致。
    model: 'glm-5.3',
    temperature: 0.7,
    maxTokens: 2048,
    // GLM-5.x 混合思考模型专用配置（其他模型自动忽略）
    // GLM-5.3 建议启用，避免默认 max 思考模式导致超时
    // GLM-5.3 支持 low / high / max；low 用于控制响应时间。
    thinking: { reasoning_effort: 'low' },
    embedding: {
      model: 'embedding-3',
      dimensions: 1024,
      batchSize: 10,
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000
    }
  },

  cloud: {
    envId: 'cloud1-6gbzplmt4a3dc5b5',
    database: 'arsenic_assistant',
    collections: {
      conversations: 'conversations',
      messages: 'messages',
      knowledgeBase: 'knowledge_base'
    }
  }
}
