function isRetryableRerankFailure(code, message) {
  return Number(code) === 500 && /知识召回服务异常|rerank|重排/i.test(String(message || ''))
}

module.exports = { isRetryableRerankFailure }
