/**
 * Neo4j 云端知识图谱 handler（Bolt 协议）
 *
 * action:
 *   - kb.graph.fetch   获取知识图谱（节点 + 关系），5 分钟缓存
 *
 * 说明：
 * - Aura Free 不支持 HTTP API（403 Denied by administrative rules），必须走 Bolt（neo4j+s:// 7687）
 * - neo4j-driver 模块懒加载，未安装时不影响云函数启动
 * - 节点 schema 约定（灵活兼容）：name（必需）/ desc / keywords / category / symbolSize
 */

const config = require('../config')
const { normalizeNeo4jParams } = require('../lib/neo4jParams')
const { normalizeTimeout } = require('../lib/neo4jTimeout')

// ============ Neo4j Driver 懒加载 ============

// Neo4j Bolt 驱动（懒加载，避免未配置时云函数启动报错）
let _neo4jDriverModule = null
function _getNeo4jDriverModule() {
  if (!_neo4jDriverModule) {
    try {
      _neo4jDriverModule = require('neo4j-driver')
    } catch (e) {
      console.warn('[Neo4j] neo4j-driver 模块未安装，图谱功能不可用。请在云函数目录执行 npm install')
      return null
    }
  }
  return _neo4jDriverModule
}

/**
 * Neo4j Driver 单例（云函数实例复用时持久化连接池）
 */
let _neo4jDriver = null

function _getNeo4jDriver() {
  if (_neo4jDriver) {
    // 验证 driver 是否仍可用
    try {
      const { verifyConnectivity } = _neo4jDriver
      if (typeof verifyConnectivity === 'function') return _neo4jDriver
    } catch (e) { /* fallthrough */ }
  }

  const neo4jModule = _getNeo4jDriverModule()
  if (!neo4jModule) {
    throw new Error('neo4j-driver 模块未安装，请在云函数目录执行 npm install')
  }

  const { uri, username, password } = config.neo4j
  if (!uri || !username || !password) {
    throw new Error('Neo4j 连接未配置（需 NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD 环境变量）')
  }

  _neo4jDriver = neo4jModule.driver(
    uri,
    neo4jModule.auth.basic(username, password),
    {
      // 连接池配置（云函数实例复用时减少握手开销）
      maxConnectionPoolSize: 5,
      connectionAcquisitionTimeout: 5000,
      connectionTimeout: 5000,
      maxConnectionLifetime: 30 * 60 * 1000  // 30 分钟
    }
  )

  console.log('[Neo4j] driver 已创建:', uri.replace(/\/\/.*@/, '//***@'))
  return _neo4jDriver
}

/**
 * 执行 Cypher 查询，返回 records 数组
 */
async function _runCypher(cypher, params = {}, timeout = 15000) {
  const driver = _getNeo4jDriver()
  const neo4jModule = _getNeo4jDriverModule()
  const database = config.neo4j.database || 'neo4j'
  const driverParams = normalizeNeo4jParams(params, value => neo4jModule.int(value))
  const timeouts = [normalizeTimeout(timeout)]

  for (let attempt = 0; attempt < timeouts.length; attempt++) {
    const session = driver.session({ database, defaultAccessMode: 'READ' })
    let tx
    try {
      tx = await session.beginTransaction({ timeout: timeouts[attempt] })
      const result = await tx.run(cypher, driverParams)
      await tx.commit()
      return result.records || []
    } catch (error) {
      if(tx){try{await tx.rollback()}catch{}}
      throw error
    } finally {
      await session.close()
    }
  }

  return []
}

/**
 * 从 record 中安全读取字段值
 */
function _getField(record, key, defaultVal = '') {
  try {
    const val = record.get(key)
    return val === null || val === undefined ? defaultVal : val
  } catch (e) {
    return defaultVal
  }
}

// 描述类字段优先级（从高到低尝试）
const DESC_FIELDS = [
  'desc', 'description', 'summary', 'detail', 'details',
  'info', 'information', 'content', 'text', 'note', 'notes',
  'definition', 'abstract', 'remark', 'about', 'intro',
  'introduction', 'overview', 'comment', 'comments', 'body'
]
// 关键词类字段
const KEYWORD_FIELDS = ['keywords', 'keyword', 'tags', 'tag']

/**
 * 从 Neo4j properties(n) 映射中提取 desc / keywords / flatProps
 * 兼容 neo4j-driver 的 Integer 等特殊类型
 */
function _extractFromProps(rawProps) {
  const flatProps = {}
  if (rawProps && typeof rawProps === 'object') {
    Object.keys(rawProps).forEach(k => {
      const v = rawProps[k]
      if (v === null || v === undefined) return
      if (typeof v.toNumber === 'function') {
        flatProps[k] = v.toNumber()
      } else if (Array.isArray(v)) {
        flatProps[k] = v.map(item =>
          (item && typeof item.toNumber === 'function') ? item.toNumber() : item
        )
      } else {
        flatProps[k] = v
      }
    })
  }

  // 提取描述：按优先级匹配第一个非空字段
  let desc = ''
  for (const f of DESC_FIELDS) {
    const val = flatProps[f]
    if (typeof val === 'string' && val.trim()) {
      desc = val.trim()
      break
    } else if (Array.isArray(val) && val.length > 0) {
      desc = val.map(String).join(', ')
      break
    }
  }

  // 提取关键词
  let keywords = ''
  for (const f of KEYWORD_FIELDS) {
    const val = flatProps[f]
    if (typeof val === 'string' && val.trim()) {
      keywords = val.trim()
      break
    } else if (Array.isArray(val) && val.length > 0) {
      keywords = val.map(String).join(', ')
      break
    }
  }

  return { flatProps, desc, keywords }
}

// 关系名称字段优先级（从高到低尝试，用于从关系属性中提取真实关系名）
const REL_NAME_FIELDS = [
  'name', 'label', 'type', 'description', 'title',
  'rel_name', 'rel_type', 'relation', 'relation_type', 'relationship',
  'verb', 'action', 'predicate', 'role'
]

/**
 * 从 Neo4j 关系属性中提取真实关系名称
 * 优先使用描述性属性，回退到 type(r)
 */
function _extractRelName(rawProps, fallbackType) {
  if (rawProps && typeof rawProps === 'object') {
    for (const f of REL_NAME_FIELDS) {
      const val = rawProps[f]
      if (typeof val === 'string' && val.trim()) {
        return val.trim()
      }
      if (typeof val === 'number' && !isNaN(val)) {
        return String(val)
      }
    }
  }
  return fallbackType || '相关'
}

// ============ 图谱缓存（5 分钟 TTL，按 keyword 分桶） ============

const _neo4jGraphCache = new Map() // keyword → { data, ts }
const NEO4J_GRAPH_TTL = 5 * 60 * 1000  // 5 分钟缓存

/**
 * 获取 Neo4j 知识图谱（节点 + 关系）
 * 返回格式与前端 graph 组件兼容：{ categories, nodes, links }
 *
 * 节点 schema 约定（灵活兼容）：
 * - name（必需）：节点唯一标识 & 显示名
 * - desc（可选）：描述，回退 description / summary
 * - keywords（可选）：关键词
 * - category（可选）：分类名；若缺失则用节点标签
 * - symbolSize（可选）：节点大小，默认 40
 */
async function handleNeo4jGraphFetch(data, context) {
  const { refresh = false, keyword = '砷', nodeLimit = 50, linkLimit = 50 } = data || {}

  // 缓存 key 按 keyword + limit 区分（不同参数不共享缓存）
  const cacheKey = `${String(keyword || '').trim() || '砷'}|n${nodeLimit}|l${linkLimit}`

  // 检查缓存
  const now = Date.now()
  const cachedEntry = _neo4jGraphCache.get(cacheKey)
  if (!refresh && cachedEntry && (now - cachedEntry.ts) < NEO4J_GRAPH_TTL) {
    return {
      success: true,
      data: cachedEntry.data,
      source: 'neo4j',
      cached: true,
      nodeCount: cachedEntry.data.nodes.length,
      linkCount: cachedEntry.data.links.length
    }
  }

  const { uri, username, password } = config.neo4j
  if (!uri || !username || !password) {
    return {
      success: false,
      error: '云函数未配置 Neo4j 环境变量（NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD）',
      isNotConfigured: true
    }
  }

  const startTs = Date.now()
  try {
    const kw = String(keyword || '').trim() || '砷'
    const nLimit = parseInt(nodeLimit) || 50
    const lLimit = parseInt(linkLimit) || 50

    // ===== 性能优化策略：分步查询，避免 OR 全表扫描 =====
    // 旧方案 16 个 OR CONTAINS 条件导致全表扫描，60s 超时
    // 新方案：
    //   Step1: 只用 name 字段查砷相关节点（name 通常有索引，最快），LIMIT nodeLimit
    //   Step2: 基于这些节点名称查关系（IN 精确匹配，走索引）
    //   Step3: 若关系不足，扩展查 1 跳邻居节点补充

    // Step1: 查砷相关核心节点（仅按 name 过滤，性能最优）
    const coreNodeCypher = [
      "MATCH (n)",
      "WHERE n.name IS NOT NULL AND n.name CONTAINS $keyword",
      "RETURN n.name as name",
      `LIMIT ${nLimit}`
    ].join(' ')
    const coreRecords = await _runCypher(coreNodeCypher, { keyword: kw })
    const coreNames = coreRecords.map(r => String(_getField(r, 'name', ''))).filter(Boolean)

    if (coreNames.length === 0) {
      const emptyGraph = { categories: [], nodes: [], links: [] }
      _neo4jGraphCache.set(cacheKey, { data: emptyGraph, ts: Date.now() })
      console.log(`[Neo4j] "${kw}"相关图谱: 未找到含"${kw}"的节点，返回空数据 (${Date.now() - startTs}ms)`)
      return {
        success: true, data: emptyGraph, source: 'neo4j', cached: false,
        duration: Date.now() - startTs, nodeCount: 0, linkCount: 0
      }
    }

    // Step2: 查核心节点之间的关系（IN 精确匹配，走索引）
    const linkCypher = [
      "MATCH (n)-[r]->(m)",
      "WHERE n.name IN $names AND m.name IN $names",
      "RETURN n.name as source, m.name as target,",
      "  type(r) as relType, properties(r) as relProps",
      `LIMIT ${lLimit}`
    ].join(' ')
    const linkRecords = await _runCypher(linkCypher, { names: coreNames })

    // 收集关系涉及的所有节点名（核心节点 + 关系对端）
    const involvedNames = new Set(coreNames)
    linkRecords.forEach(record => {
      involvedNames.add(String(_getField(record, 'source', '')))
      involvedNames.add(String(_getField(record, 'target', '')))
    })

    // Step3: 若关系数不足 lLimit，尝试扩展 1 跳邻居节点补充关系
    if (linkRecords.length < lLimit) {
      const neighborCypher = [
        "MATCH (core)-[r]-(neighbor)",
        "WHERE core.name IN $names AND neighbor.name IS NOT NULL",
        "  AND NOT (neighbor.name IN $names OR neighbor.name IN $involved)",
        "RETURN DISTINCT neighbor.name as name, core.name as coreName,",
        "  type(r) as relType, properties(r) as relProps,",
        "  core.name as source, neighbor.name as target",
        `LIMIT ${lLimit - linkRecords.length}`
      ].join(' ')
      const neighborRecords = await _runCypher(neighborCypher, {
        names: coreNames,
        involved: Array.from(involvedNames)
      })
      neighborRecords.forEach(record => {
        const neighborName = String(_getField(record, 'name', ''))
        const coreName = String(_getField(record, 'coreName', ''))
        const source = String(_getField(record, 'source', ''))
        const target = String(_getField(record, 'target', ''))
        const relType = String(_getField(record, 'relType', '相关'))
        const relProps = _getField(record, 'relProps', {})
        if (neighborName) involvedNames.add(neighborName)
        if (source && target) {
          linkRecords.push({
            source, target, relType, relProps,
            _neighbor: true,
            _neighborName: neighborName,
            _coreName: coreName
          })
        }
      })
    }

    // Step4: 批量查询所有涉及节点的完整属性（一次查询，避免 N+1）
    const allNames = Array.from(involvedNames).filter(Boolean)
    const nodePropsCypher = [
      "MATCH (n)",
      "WHERE n.name IN $names",
      "RETURN n.name as name,",
      "  properties(n) as props,",
      "  coalesce(n.category, head(labels(n)), '未分类') as category,",
      "  coalesce(n.symbolSize, 40) as symbolSize"
    ].join(' ')
    const nodePropRecords = await _runCypher(nodePropsCypher, { names: allNames })

    // 构建节点数据（按 name 去重）
    const catNames = []
    const catSet = new Set()
    const nodeNameSet = new Set()
    const nodes = []
    nodePropRecords.forEach(record => {
      const name = String(_getField(record, 'name', ''))
      if (!name || nodeNameSet.has(name)) return
      nodeNameSet.add(name)
      const catName = _getField(record, 'category', '未分类')
      if (!catSet.has(catName)) { catSet.add(catName); catNames.push(catName) }
      const rawProps = _getField(record, 'props', {})
      const { flatProps, desc, keywords } = _extractFromProps(rawProps)
      nodes.push({
        name, desc, keywords, props: flatProps,
        category: catNames.indexOf(catName),
        symbolSize: Number(_getField(record, 'symbolSize', 40)) || 40
      })
    })

    const categories = catNames.map(n => ({ name: n }))

    // 构建关系数据
    const links = []
    linkRecords.forEach(record => {
      const source = String(_getField(record, 'source', ''))
      const target = String(_getField(record, 'target', ''))
      const rawRelType = String(_getField(record, 'relType', '相关'))
      const rawRelProps = _getField(record, 'relProps', {})
      const relType = _extractRelName(rawRelProps, rawRelType)
      if (source && target && nodeNameSet.has(source) && nodeNameSet.has(target)) {
        links.push({ source, target, relType })
      }
    })

    const graphData = { categories, nodes, links }

    // 更新缓存（按 keyword 分桶）
    _neo4jGraphCache.set(cacheKey, { data: graphData, ts: Date.now() })

    const duration = Date.now() - startTs
    console.log(`[Neo4j] "${kw}"相关图谱获取成功 ${duration}ms, ${nodes.length} 节点, ${links.length} 关系, ${categories.length} 分类`)

    return {
      success: true,
      data: graphData,
      source: 'neo4j',
      cached: false,
      duration,
      nodeCount: nodes.length,
      linkCount: links.length
    }
  } catch (e) {
    const duration = Date.now() - startTs
    console.error(`[Neo4j] 图谱获取失败 ${duration}ms:`, e.message)
    // 连接失败时重置 driver，下次调用重新创建
    if (/_connection_|_connect_|ECONNREFUSED|ENOTFOUND|handshake|certificate/i.test(e.message)) {
      try { if (_neo4jDriver) await _neo4jDriver.close() } catch (closeErr) { /* ignore */ }
      _neo4jDriver = null
    }
    return {
      success: false,
      error: e.message || 'Neo4j 图谱获取失败',
      source: 'neo4j',
      duration
    }
  }
}

module.exports = {
  handleNeo4jGraphFetch,
  runReadOnlyCypher: _runCypher
}
