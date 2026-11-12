/**
 * 将图谱检索证据转换为小程序可直接渲染的节点—连线布局数据。
 * 不依赖 Canvas 或第三方库，便于随对话消息持久化与历史恢复。
 */
function buildEvidenceGraph(chunks, options = {}) {
  const maxEdges = Math.min(Math.max(Number(options.maxEdges) || 20, 1), 20)
  const facts = (Array.isArray(chunks) ? chunks : [])
    .filter(chunk => chunk && chunk.sourceType === 'neo4j' &&
      Array.isArray(chunk.nodes) && chunk.nodes.length >= 2 && chunk.relation)
    .slice(0, maxEdges)

  if (!facts.length) return null

  const nodeByName = new Map()
  const addNode = (name) => {
    const label = String(name || '').trim()
    if (!label) return null
    if (!nodeByName.has(label)) nodeByName.set(label, { id: `node-${nodeByName.size}`, label, degree: 0 })
    return nodeByName.get(label)
  }
  const edges = []
  facts.forEach((fact, index) => {
    const source = addNode(fact.nodes[0])
    const target = addNode(fact.nodes[1])
    if (!source || !target || source === target) return
    source.degree++
    target.degree++
    edges.push({
      id: String(fact.id || `edge-${index}`),
      sourceId: source.id,
      targetId: target.id,
      relation: String(fact.relation).trim()
    })
  })
  if (!edges.length) return null

  const nodes = Array.from(nodeByName.values())
  const columns = nodes.length <= 4 ? nodes.length : nodes.length <= 12 ? 4 : 5
  const nodeWidth = 136
  const nodeHeight = 62
  const columnGap = 34
  const rowGap = 64
  const paddingX = 42
  const paddingY = 52
  const rows = Math.ceil(nodes.length / columns)
  const width = Math.max(680, paddingX * 2 + columns * nodeWidth + Math.max(0, columns - 1) * columnGap)
  const height = Math.max(270, paddingY * 2 + rows * nodeHeight + Math.max(0, rows - 1) * rowGap)
  const positioned = new Map()

  nodes.forEach((node, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const left = paddingX + column * (nodeWidth + columnGap)
    const top = paddingY + row * (nodeHeight + rowGap)
    const positionedNode = {
      ...node,
      left,
      top,
      centerX: left + nodeWidth / 2,
      centerY: top + nodeHeight / 2,
      isCore: node.degree > 1
    }
    positioned.set(node.id, positionedNode)
  })

  const renderedEdges = edges.map(edge => {
    const source = positioned.get(edge.sourceId)
    const target = positioned.get(edge.targetId)
    const dx = target.centerX - source.centerX
    const dy = target.centerY - source.centerY
    const distance = Math.sqrt(dx * dx + dy * dy) || 1
    const offset = Math.min(54, Math.max(24, distance / 3))
    const startX = source.centerX + dx / distance * offset
    const startY = source.centerY + dy / distance * offset
    const endX = target.centerX - dx / distance * offset
    const endY = target.centerY - dy / distance * offset
    const lineDx = endX - startX
    const lineDy = endY - startY
    return {
      id: edge.id,
      relation: edge.relation,
      left: Math.round(startX),
      top: Math.round(startY),
      width: Math.max(12, Math.round(Math.sqrt(lineDx * lineDx + lineDy * lineDy))),
      angle: Math.round(Math.atan2(lineDy, lineDx) * 180 / Math.PI * 10) / 10,
      labelLeft: Math.round((startX + endX) / 2 - 52),
      labelTop: Math.round((startY + endY) / 2 - 20)
    }
  })

  return {
    nodeCount: nodes.length,
    edgeCount: renderedEdges.length,
    width,
    height,
    nodes: Array.from(positioned.values()).map(({ centerX, centerY, degree, ...node }) => node),
    edges: renderedEdges
  }
}

module.exports = { buildEvidenceGraph }
