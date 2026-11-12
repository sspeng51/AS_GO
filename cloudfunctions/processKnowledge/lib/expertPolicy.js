'use strict'

// This engine and its document-derived rules are copied into the SSE deployment
// by tools/build-expert-policy.js. Neither deployment imports outside its package.
const policy = require('./expertRules.json')
const MAX_CONTEXT_CHARS = 6000
const MAX_RULES = 10

function matches(text, term) {
  const value = term.toLowerCase()
  if (/^[a-z0-9 ()]+$/.test(value)) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(text)
  }
  return text.includes(value)
}

function isDomainQuery(text) {
  return policy.domainTerms.some(term => matches(text, term))
}

function languageForQuery(query) {
  const text = String(query || '')
  return !/[\u3400-\u9fff]/.test(text) && /[a-z]/i.test(text) ? 'en' : 'zh'
}

function retrieveExpertGuidance(query, options = {}) {
  const text = String(query || '').slice(0, 12000).toLowerCase()
  const enabled = options.enabled !== false
  const language = options.language === 'en' || options.language === 'zh' ? options.language : languageForQuery(query)
  const localized = language === 'en' ? policy.translations.en : policy
  const localizedRules = new Map(localized.rules.map(rule => [rule.id, rule]))
  const metadata = {
    enabled, language, version: policy.version, sourceHash: localized.sourceHash,
    indexSourceHash: policy.sourceHash,
    policyStatus: policy.policyStatus, technicalReviewStatus: policy.technicalReviewStatus,
    source: localized.source, ruleIds: [], count: 0, contextChars: 0
  }
  if (!enabled || !isDomainQuery(text + ' ' + String(options.domainContext || '').slice(0, 4000).toLowerCase())) {
    return { context: '', rules: [], metadata: { ...metadata, status: enabled ? 'not_applicable' : 'disabled' } }
  }
  const ranked = policy.rules.map(rule => ({
    rule,
    score: rule.keywords.filter(term => matches(text, term)).length
  })).filter(item => item.rule.core || item.score > 0)
    .sort((a, b) => Number(b.rule.core) - Number(a.rule.core) || b.score - a.score || a.rule.id.localeCompare(b.rule.id))
  let context = language === 'en'
    ? `[Metallurgical Arsenic Expert Standard v${policy.version}]\nSoftware answer-governance rules; enterprise technical review pending. These are not technical evidence or plant operating procedures. Rule matches are not evidence matches.\n`
    : `【冶金砷专家回答规范 v${policy.version}】\n以下是软件回答治理规则；企业技术审核待完成，不是文献证据或企业操作规程。不得用规则命中替代证据命中。\n`
  const rules = []
  for (const { rule } of ranked) {
    if (rules.length >= MAX_RULES) break
    const translated = localizedRules.get(rule.id)
    const section = `\n[${rule.id}] ${translated.title}\n${translated.content}\n`
    // Never cut away exceptions or requirements to fit a partial rule.
    if (context.length + section.length > MAX_CONTEXT_CHARS) continue
    context += section
    rules.push({ id: rule.id, title: translated.title })
  }
  return {
    context, rules,
    metadata: { ...metadata, status: 'applied', ruleIds: rules.map(rule => rule.id), count: rules.length, contextChars: context.length }
  }
}

function queryFromMessages(messages) {
  const users = messages.filter(item => item && item.role === 'user' && typeof item.content === 'string')
    .slice(-3).map(item => item.content.slice(0, 4000))
  const latest = users[users.length - 1] || ''
  // Explicit domain questions stand alone. Short follow-ups and continuation
  // requests inherit user context, never assistant claims or retrieved documents.
  if (isDomainQuery(latest.toLowerCase())) return latest
  if (latest.length <= 120 && /这|那|它|继续|上一次|多少|为什么|怎么|如何|成本|浓度|流量|达标|合规|处置|标准|稳定|去除率|能否|是否|\b(it|that|this|continue|why|how|cost|what about|concentration|flow|compliance|disposal)\b/i.test(latest)) {
    return users.join('\n')
  }
  return latest
}

function applyExpertPolicy(messages, options = {}) {
  const latestUser = messages.filter(item => item && item.role === 'user' && typeof item.content === 'string').slice(-1)[0]
  const guidance = retrieveExpertGuidance(queryFromMessages(messages), {
    ...options,
    language: options.language || languageForQuery(latestUser && latestUser.content)
  })
  const result = messages.map(message => ({ ...message }))
  if (guidance.context) {
    const systemIndex = result.findIndex(message => message.role === 'system')
    if (systemIndex >= 0) {
      result[systemIndex].content = `${guidance.context}\n\n${String(result[systemIndex].content || '')}`
    } else {
      result.unshift({ role: 'system', content: guidance.context })
    }
  }
  const instruction = require('./focusedEvidence').instruction
  const system = result.find(m=>m.role==='system')
  if (system) system.content = `${system.content}\n\n${instruction}`
  else result.unshift({role:'system',content:instruction})
  return { messages: result, metadata: guidance.metadata }
}

module.exports = { retrieveExpertGuidance, applyExpertPolicy, queryFromMessages, MAX_CONTEXT_CHARS, MAX_RULES }
