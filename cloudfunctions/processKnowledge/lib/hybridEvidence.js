const focusedEvidence = require('./focusedEvidence')
'use strict'

const { canonicalRelationType } = require('./domainGraphSchema')

function plainValue(value) {
  if (value === null || value === undefined) return value
  if (typeof value.toNumber === 'function') return value.toNumber()
  if (Array.isArray(value)) return value.map(plainValue)
  if (typeof value === 'object') {
    const result = {}
    Object.keys(value).forEach(key => { result[key] = plainValue(value[key]) })
    return result
  }
  return value
}

function recordValue(record, key, fallback) {
  try {
    const value = record.get(key)
    return value === null || value === undefined ? fallback : value
  } catch (error) {
    return fallback
  }
}

function nodeName(node) {
  const props = plainValue(node && node.properties) || {}
  return String(props.name || props.title || props.label || node && node.elementId || '未命名节点')
}

function nodeDescription(node) {
  const props = plainValue(node && node.properties) || {}
  for (const key of ['desc', 'description', 'summary', 'content', 'text']) {
    if (props[key]) return String(props[key]).trim().substring(0, 300)
  }
  return ''
}

function normalizeGraphRecords(records, maxFacts) {
  const evidences = []
  const seen = new Set()
  for (const record of records || []) {
    const nodes = recordValue(record, 'nodes', []) || []
    const relationships = recordValue(record, 'relationships', []) || []
    for (let index = 0; index < relationships.length && index + 1 < nodes.length; index++) {
      const relation = relationships[index]
      let sourceNode = nodes[index]
      let targetNode = nodes[index + 1]
      if (relation && relation.startNodeElementId && targetNode && targetNode.elementId === relation.startNodeElementId) {
        sourceNode = nodes[index + 1]
        targetNode = nodes[index]
      }
      const source = nodeName(sourceNode)
      const target = nodeName(targetNode)
      const propertyRelation = relation && relation.properties && relation.properties.type
      const structuralRelation = relation && relation.type
      const relationName = canonicalRelationType(propertyRelation) || canonicalRelationType(structuralRelation)
      if (!relationName) continue
      const title = `${source} —${relationName}→ ${target}`
      if (seen.has(title)) continue
      seen.add(title)
      const descriptions = [nodeDescription(sourceNode), nodeDescription(targetNode)].filter(Boolean)
      evidences.push({
        id: `neo4j_${evidences.length + 1}`,
        sourceType: 'neo4j',
        title,
        content: descriptions.length ? `${title}\n${descriptions.join('\n')}` : title,
        nodes: [source, target],
        relation: relationName,
        searchMode: 'neo4j'
      })
      if (evidences.length >= maxFacts) return evidences
    }
  }
  return evidences
}

function documentEvidences(result, ragConfig) {
  const threshold = (Number(ragConfig.context.minScore) || 0) / 100
  const maxChunks = Math.max(Number(ragConfig.context.maxChunks) || 10, 1)
  const seen = new Set()
  return (result.results || []).map(item => ({
    ...item,
    sourceType: 'zhipu',
    score: (Number(item.score) || 0) / 100
  })).filter(item => {
    if (item.score < threshold) return false
    const fingerprint = `${item.documentId || item.title}|${String(item.content || '').slice(0, 100)}`
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  }).slice(0, maxChunks)
}

function qualityFromDocuments(documents, hasGraph) {
  if (!documents.length) return hasGraph ? 'medium' : 'no_match'
  const top = Number(documents[0].score) || 0
  if (top >= 0.55) return 'high'
  if (top >= 0.30) return 'medium'
  if (top >= 0.15) return 'low'
  if (top >= 0.05) return 'very_low'
  return hasGraph ? 'medium' : 'minimal'
}

function buildContext(documents, graphFacts, ragConfig, query = '') {
  const focused = Boolean(query)
  const selectedGraph = focused ? focusedEvidence.selectGraph(graphFacts.map((s,i)=>({...s,id:s.id || `G${i+1}`,originalIndex:i})),query).sources : graphFacts
  const sections = []
  const docBudget = Math.max(Number(ragConfig.context.maxTokens) || 2000, 1) * 4
  const graphBudget = Math.max(Number(ragConfig.graph.contextMaxTokens) || 800, 1) * 4
  if (documents.length) {
    let remaining = docBudget
    const lines = ['【文档参考】']
    documents.forEach((item, index) => {
      const prefix = `[文档${index + 1}] ${item.title}\n`
      const available=Math.max(remaining-prefix.length,0)
      const budget=focused ? Math.min(available,Math.floor(docBudget/documents.length)-prefix.length) : available
      const content=budget>150 && focused ? focusedEvidence.excerpt(item.content,query,budget).content : String(item.content || '').substring(0,Math.max(budget,0))
      if (content) {
        lines.push(prefix + content)
        remaining -= prefix.length + content.length
      }
    })
    sections.push(lines.join('\n\n'))
  }
  if (selectedGraph.length) {
    let remaining = graphBudget
    const lines = ['【知识图谱关系（原始来源须核实）】']
    selectedGraph.forEach((item, index) => {
      const line = `[图谱${(item.originalIndex ?? index) + 1}] ${item.content}`
      const content = line.substring(0, Math.max(remaining, 0))
      if (content) {
        lines.push(content)
        remaining -= content.length
      }
    })
    sections.push(lines.join('\n\n'))
  }
  return sections.join('\n\n')
}

module.exports = { plainValue, normalizeGraphRecords, documentEvidences, qualityFromDocuments, buildContext }
