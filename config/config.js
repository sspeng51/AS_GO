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
    //   - glm-4.5-flash（推荐,5-10s,质量中等）
    //   - glm-4.5-air（慢,质量高,可能超时）
    //   - glm-4.7-flash（混合思考,默认吃满token）
    //   - glm-5.2（旗舰混合思考，需配合 thinking 配置控制响应时间）
    // 
    // ============================================================
    // 保持与已部署云函数及流式服务白名单一致；glm-5.3 不在当前项目支持列表内，会被上游以 400 拒绝。
    model: 'glm-5.2',
    temperature: 0.7,
    maxTokens: 2048,
    // GLM-5.x 混合思考模型专用配置（其他模型自动忽略）
    // 切换到 glm-5.2 时建议启用，避免默认 max 思考模式导致超时
    // 思考强度档位：low（最快）< medium < high < max（默认最慢）
    // 切换 glm-5.2 时推荐配置：{ reasoning_effort: 'high' }  或  { enable_thinking: false }
    thinking: { reasoning_effort: 'medium' },   // null=不传该参数(模型用默认); 切换 5.2 时改为 { reasoning_effort: 'medium' }
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
