'use strict'

const {
  ENTITY_TYPE_ALIASES,
  RELATION_TYPE_ALIASES,
  aliasesForDomainType
} = require('./domainGraphSchema')

const FORBIDDEN_KEYWORDS = [
  'CREATE', 'MERGE', 'DELETE', 'DETACH', 'SET', 'REMOVE', 'DROP',
  'LOAD', 'CSV', 'CALL', 'YIELD', 'APOC', 'DBMS', 'FOREACH', 'GRANT',
  'DENY', 'REVOKE', 'ALTER', 'RENAME', 'START', 'STOP', 'TERMINATE',
  'USE', 'SHOW', 'UNION', 'EXPLAIN', 'PROFILE', 'INDEX', 'CONSTRAINT',
  'ORDER', 'SKIP'
]

function parsePlannerJson(content) {
  const text = String(content || '').trim()
  if (!text) throw new Error('Cypher 规划模型返回空内容')
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Cypher 规划结果不是 JSON 对象')

  let parsed
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1))
  } catch (error) {
    throw new Error('Cypher 规划结果 JSON 解析失败')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Cypher 规划结果格式无效')
  }
  return {
    entities: Array.isArray(parsed.entities)
      ? parsed.entities.map(item => String(item || '').trim()).filter(Boolean).slice(0, 10)
      : [],
    relations: Array.isArray(parsed.relations)
      ? parsed.relations.map(item => String(item || '').trim()).filter(Boolean).slice(0, 10)
      : [],
    entityTypes: Array.isArray(parsed.entityTypes)
      ? parsed.entityTypes.map(item => ({
        name: String(item && item.name || '').trim(),
        type: String(item && item.type || '').trim()
      })).filter(item => item.name && item.type).slice(0, 10)
      : [],
    entityAliases: parsed.entityAliases && typeof parsed.entityAliases === 'object' && !Array.isArray(parsed.entityAliases)
      ? Object.fromEntries(Object.entries(parsed.entityAliases).slice(0, 10).map(([name, aliases]) => [
        String(name || '').trim(),
        Array.isArray(aliases) ? aliases.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8) : []
      ]).filter(([name]) => name))
      : {},
    intent: String(parsed.intent || '').trim().substring(0, 500),
    cypher: String(parsed.cypher || '').trim(),
    params: parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)
      ? parsed.params
      : {}
  }
}

function validateReadOnlyCypher(cypher, params, options = {}) {
  const query = String(cypher || '').trim()
  const maxHops = Math.min(Math.max(Number(options.maxHops) || 2, 1), 4)
  const maxFacts = Math.min(Math.max(Number(options.maxFacts) || 12, 1), 50)
  if (!query) throw new Error('Cypher 不能为空')
  if (query.length > 4000) throw new Error('Cypher 长度超过限制')
  if (/;/.test(query)) throw new Error('Cypher 只允许单条语句')
  if (/\/\*|\*\/|\/\/|--/.test(query)) throw new Error('Cypher 不允许包含注释')
  if (/['"]/.test(query)) throw new Error('Cypher 中的查询值必须使用参数，不能使用字符串字面量')
  if (!/^\s*(?:OPTIONAL\s+)?MATCH\b/i.test(query)) {
    throw new Error('Cypher 必须以 MATCH 或 OPTIONAL MATCH 开始')
  }
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(query)) {
      throw new Error(`Cypher 包含禁止关键字: ${keyword}`)
    }
  }
  if (!/\bRETURN\s+nodes\s*\(\s*p\s*\)\s+AS\s+nodes\s*,\s*relationships\s*\(\s*p\s*\)\s+AS\s+relationships\b/i.test(query)) {
    throw new Error('Cypher 必须按约定返回 nodes(p) AS nodes 和 relationships(p) AS relationships')
  }
  if (!/\bp\s*=\s*/i.test(query)) throw new Error('Cypher 必须将查询路径命名为 p')
  if (!/\bLIMIT\s+\$limit\s*$/i.test(query)) {
    throw new Error('Cypher 必须以 LIMIT $limit 结束')
  }
  if (!/\bWHERE\b/i.test(query)) throw new Error('Cypher 必须通过 WHERE 使用实体参数缩小查询范围')

  const safeParams = params && typeof params === 'object' && !Array.isArray(params) ? { ...params } : {}
  const referenced = Array.from(query.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g), match => match[1])
  if (!referenced.length || referenced.some(name => !Object.prototype.hasOwnProperty.call(safeParams, name))) {
    throw new Error('Cypher 参数不完整')
  }
  if (!referenced.some(name => name !== 'limit')) throw new Error('Cypher 必须引用至少一个实体参数')
  for (const [name, value] of Object.entries(safeParams)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Cypher 参数名无效')
    if (['__proto__', 'prototype', 'constructor'].includes(name)) throw new Error('Cypher 参数名不安全')
    if (!referenced.includes(name)) throw new Error(`存在未使用的 Cypher 参数: ${name}`)
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value) &&
        !(Array.isArray(value) && value.every(item => ['string', 'number', 'boolean'].includes(typeof item)))) {
      throw new Error(`Cypher 参数类型不安全: ${name}`)
    }
    if (typeof value === 'string' && value.length > 500) throw new Error(`Cypher 参数过长: ${name}`)
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Cypher 数值参数无效: ${name}`)
    if (Array.isArray(value) && (value.length > 50 || value.some(item => typeof item === 'string' && item.length > 500))) {
      throw new Error(`Cypher 数组参数超过限制: ${name}`)
    }
  }

  safeParams.limit = Math.min(Math.max(Math.floor(Number(safeParams.limit) || maxFacts), 1), maxFacts)
  const relationshipPatterns = (query.match(/(?:<-\s*|-\s*)\[[^\]]*\]\s*(?:->|-)/g) || [])
  if (relationshipPatterns.length > maxHops) throw new Error(`Cypher 路径超过最大 ${maxHops} 跳限制`)
  for (const pattern of relationshipPatterns) {
    if (/\*/.test(pattern) && !/\*\d+\.\.\d+/.test(pattern)) {
      throw new Error('Cypher 可变路径必须声明最小和最大跳数')
    }
    const variableRange = pattern.match(/\*(\d+)?\.\.(\d+)/)
    if (variableRange && Number(variableRange[2]) > maxHops) {
      throw new Error(`Cypher 可变路径超过最大 ${maxHops} 跳限制`)
    }
  }
  return { cypher: query, params: safeParams }
}

function unquoteIdentifier(value) {
  const text = String(value || '').trim()
  return text.startsWith('`') && text.endsWith('`') ? text.slice(1, -1).replace(/``/g, '`') : text
}

function validateCypherAgainstSchema(cypher, schema) {
  const query = String(cypher || '')
  const nodeLabels = new Set((schema && schema.nodes || []).map(item => String(item.label)))
  const relationshipTypes = new Set((schema && schema.relationships || []).map(item => String(item.type)))
  const properties = new Set(['name'])
  for (const item of (schema && schema.nodes || [])) {
    for (const property of item.properties || []) properties.add(String(property))
  }
  for (const item of (schema && schema.relationships || [])) {
    for (const property of item.properties || []) properties.add(String(property))
  }
  const identifier = '(`(?:``|[^`])+`|[\\p{L}_][\\p{L}\\p{N}_]*)'
  const collectTypedIdentifiers = (segmentPattern) => {
    const found = []
    for (const segment of query.match(segmentPattern) || []) {
      const regex = new RegExp(`:\\s*${identifier}`, 'gu')
      let match
      while ((match = regex.exec(segment))) found.push(unquoteIdentifier(match[1]))
    }
    return found
  }
  for (const label of collectTypedIdentifiers(/\([^)]*\)/g)) {
    if (!nodeLabels.has(label)) throw new Error(`Cypher 使用了 schema 外的节点标签: ${label}`)
  }
  for (const type of collectTypedIdentifiers(/\[[^\]]*\]/g)) {
    if (!relationshipTypes.has(type)) throw new Error(`Cypher 使用了 schema 外的关系类型: ${type}`)
  }
  const propertyRegex = new RegExp(`\\.\\s*${identifier}`, 'gu')
  let propertyMatch
  while ((propertyMatch = propertyRegex.exec(query))) {
    const property = unquoteIdentifier(propertyMatch[1])
    if (!properties.has(property)) throw new Error(`Cypher 使用了 schema 外的属性: ${property}`)
  }
  return true
}

/**
 * 当规划模型正确识别实体/关系、但输出的 Cypher 不满足安全格式时，生成保守的参数化模板。
 * 仅使用 name（项目图谱的节点必备属性）及运行时 schema 已声明的 type 属性。
 */
function buildConstrainedCypher(plan, schema, options = {}) {
  const entities = Array.isArray(plan && plan.entities) ? plan.entities.map(String).filter(Boolean).slice(0, 3) : []
  if (!entities.length) throw new Error('无法生成模板 Cypher：未识别实体')
  const nodeProperties = new Set()
  const relationshipProperties = new Set()
  for (const node of (schema && schema.nodes || [])) {
    for (const property of node.properties || []) nodeProperties.add(String(property))
  }
  for (const relation of (schema && schema.relationships || [])) {
    for (const property of relation.properties || []) relationshipProperties.add(String(property))
  }
  if (!nodeProperties.has('name')) throw new Error('无法生成模板 Cypher：图谱 schema 缺少节点 name 属性')

  const params = { limit: Math.min(Math.max(Number(options.maxFacts) || 20, 1), 20) }
  const searchableProperties = ['name', 'name_zh', 'name_en', 'title', 'label']
    .filter(property => nodeProperties.has(property)).slice(0,3)
  const entityConditions = entities.map((entity, index) => {
    const name = `entity_terms${index}`
    const aliases = plan && plan.entityAliases && Array.isArray(plan.entityAliases[entity])
      ? plan.entityAliases[entity]
      : []
    params[name] = [...new Set([entity, ...aliases].map(String).map(item => item.trim()).filter(Boolean))].slice(0, 10)
    const propertyConditions = searchableProperties.map(property =>
      `(toLower(toString(a.${property})) = toLower(term) OR (size(term) > 2 AND toLower(toString(a.${property})) CONTAINS toLower(term)) OR (term =~ $cjkPattern AND toLower(toString(a.${property})) CONTAINS toLower(term)))`)
    return `ANY(term IN $${name} WHERE ${propertyConditions.join(' OR ')})`
  })
  params.cjkPattern='.*[\\u3400-\\u9fff].*'
  params.seedLimit=200
  const seedWhere=`(${entityConditions.join(' OR ')})`
  const where = []

  const relations = Array.isArray(plan && plan.relations) ? plan.relations.map(String).filter(Boolean) : []
  if (relations.length && relationshipProperties.has('type')) {
    params.rel_types = [...new Set(relations.flatMap(type => aliasesForDomainType(type, RELATION_TYPE_ALIASES)))]
    where.push('toLower(toString(r.type)) IN [type IN $rel_types | toLower(type)]')
  }
  const entityTypes = Array.isArray(plan && plan.entityTypes)
    ? plan.entityTypes.map(item => String(item && item.type || '')).filter(Boolean)
    : []
  if (entityTypes.length && nodeProperties.has('type')) {
    params.entity_types = [...new Set(entityTypes.flatMap(type => aliasesForDomainType(type, ENTITY_TYPE_ALIASES)))]
    where.push('(toLower(toString(a.type)) IN [type IN $entity_types | toLower(type)] OR toLower(toString(b.type)) IN [type IN $entity_types | toLower(type)])')
  }

  return {
    cypher: `MATCH (a) WHERE ${seedWhere} WITH a LIMIT $seedLimit MATCH p=(a)-[r]-(b)${where.length?' WHERE '+where.join(' AND '):''} RETURN nodes(p) AS nodes, relationships(p) AS relationships LIMIT $limit`,
    params
  }
}

module.exports = { parsePlannerJson, validateReadOnlyCypher, validateCypherAgainstSchema, buildConstrainedCypher, FORBIDDEN_KEYWORDS }
