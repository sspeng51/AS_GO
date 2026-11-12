/**
 * 将 JSON 参数中的安全整数转换为 neo4j-driver Integer。
 *
 * JavaScript 只有 number 类型，驱动可能把来自 JSON 的 20 编码为 20.0；
 * Neo4j 的 LIMIT / SKIP 参数要求 Integer，因此在执行边界统一转换。
 */
function normalizeNeo4jParams(value, toInteger) {
  if (Number.isSafeInteger(value)) {
    return toInteger(value)
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeNeo4jParams(item, toInteger))
  }

  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.keys(value).reduce((result, key) => {
      result[key] = normalizeNeo4jParams(value[key], toInteger)
      return result
    }, {})
  }

  return value
}

module.exports = {
  normalizeNeo4jParams
}
