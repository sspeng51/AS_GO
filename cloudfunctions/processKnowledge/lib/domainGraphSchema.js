'use strict'

// 铜冶炼砷资源化处理领域强约束 Schema。
// 与 extract_graph/schema.py 保持一致；实体类别通常存放在节点 type 属性中，
// 关系类别通常存放在关系 type 属性中，不应擅自拆分带“/”的规范名称。
const ENTITY_TYPES = Object.freeze([
  ['物料物质', '冶炼投入的原料或中间物，如铜精矿、冰铜、粗铜、As2O3、硫酸'],
  ['工艺过程', '冶炼或化工单元操作，如熔炼、吹炼、焙烧、浸出、挥发、电解'],
  ['设备设施', '生产设备或装置，如闪速炉、转炉、电解槽、收尘系统'],
  ['参数指标', '可量化的工艺或质量参数，如温度、品位、回收率、脱砷率、pH'],
  ['产物废料', '工艺产出物或废弃物流，如阴极铜、炉渣、烟尘、含砷污泥'],
  ['组织机构', '相关单位、企业或研究机构'],
  ['环境要素', '环境与安全对象，如含砷废水、危险废物、砷污染、砷化氢'],
  ['化学元素/化合物', '元素或化合物，如 Cu、As、S、砷化氢、硫酸盐、砷酸盐'],
  ['添加剂', '辅助试剂、熔剂、沉淀剂等，如石灰石、铁盐、氧化剂、还原剂'],
  ['检测方法', '分析测试或表征技术，如 XRF、ICP-MS、XRD、SEM-EDS、AAS'],
  ['工艺阶段', '冶炼大流程阶段，如造锍熔炼、吹炼、火法精炼、电解精炼、烟尘处理'],
  ['标准规范', '排放、质量或行业标准及量化限值，如 GB 25467、排放限值']
])

const RELATION_TYPES = Object.freeze([
  ['含有', '物料含某种元素或化合物'],
  ['产生', '工艺产出某产物'],
  ['消耗', '工艺消耗某物料'],
  ['采用工艺', '物料或产物采用某工艺'],
  ['发生于', '工艺发生在某设备中'],
  ['参数为', '工艺或设备具有某项参数'],
  ['转化为', '物质转化为产物'],
  ['脱除/去除', '工艺脱除某物质'],
  ['回收', '工艺回收某元素'],
  ['富集于', '元素富集到某产物中'],
  ['挥发进入', '元素挥发进入某产物或物流'],
  ['共沉淀', '物质与沉淀剂共沉淀生成产物'],
  ['污染/危害', '物质污染或危害环境要素'],
  ['属于/是一种', '实体间的分类或从属关系'],
  ['处理/治理', '工艺处理某废料或废水'],
  ['制造/实施方', '产物或工艺的实施组织'],
  ['分解', '物质分解为产物或组分'],
  ['吸附', '物质吸附到某介质或吸附剂上'],
  ['检测', '用某方法检测或表征某物质'],
  ['达到', '参数或指标达到某标准或限值'],
  ['排放', '工艺或设施排放某废料或污染物'],
  ['溶解', '物质溶解于某溶剂或溶液'],
  ['沉淀', '物质沉淀生成产物'],
  ['氧化/还原', '物质被氧化或还原']
])

const ENTITY_TYPE_NAMES = Object.freeze(ENTITY_TYPES.map(item => item[0]))
const RELATION_TYPE_NAMES = Object.freeze(RELATION_TYPES.map(item => item[0]))
const ENTITY_TYPE_ALIASES = Object.freeze({
  '物料物质': ['material', 'substance'],
  '工艺过程': ['process', 'operation'],
  '设备设施': ['equipment', 'facility'],
  '参数指标': ['parameter', 'indicator'],
  '产物废料': ['product', 'waste'],
  '组织机构': ['organization', 'institution'],
  '环境要素': ['environmental factor', 'environment'],
  '化学元素/化合物': ['chemical element/compound', 'chemical element', 'compound'],
  '添加剂': ['additive'],
  '检测方法': ['analytical method', 'detection method'],
  '工艺阶段': ['process stage'],
  '标准规范': ['standard', 'specification']
})
const RELATION_TYPE_ALIASES = Object.freeze({
  '含有': ['contains', 'contain'],
  '产生': ['produces', 'generates'],
  '消耗': ['consumes'],
  '采用工艺': ['uses process', 'processed by'],
  '发生于': ['occurs in'],
  '参数为': ['has parameter'],
  '转化为': ['converts to', 'transforms into'],
  '脱除/去除': ['removes', 'removal'],
  '回收': ['recovers', 'recovery'],
  '富集于': ['enriched in', 'concentrates in'],
  '挥发进入': ['volatilizes into', 'volatilises into'],
  '共沉淀': ['coprecipitates with', 'co-precipitates with'],
  '污染/危害': ['pollutes', 'hazards'],
  '属于/是一种': ['is a', 'belongs to'],
  '处理/治理': ['treats', 'treatment'],
  '制造/实施方': ['manufactured by', 'implemented by'],
  '分解': ['decomposes'],
  '吸附': ['adsorbs'],
  '检测': ['detects', 'measures'],
  '达到': ['meets', 'achieves'],
  '排放': ['emits', 'discharges'],
  '溶解': ['dissolves'],
  '沉淀': ['precipitates'],
  '氧化/还原': ['oxidizes/reduces', 'oxidation/reduction']
})
const ENTITY_TYPE_SET = new Set(ENTITY_TYPE_NAMES)
const RELATION_TYPE_SET = new Set(RELATION_TYPE_NAMES)

function aliasesForDomainType(type, aliasMap) {
  const canonical = String(type || '')
  return [...new Set([canonical, ...(aliasMap[canonical] || [])])]
}

function canonicalRelationType(type) {
  const normalized = String(type || '').trim().toLocaleLowerCase('en-US')
  for (const canonical of RELATION_TYPE_NAMES) {
    if (aliasesForDomainType(canonical, RELATION_TYPE_ALIASES)
      .some(alias => alias.toLocaleLowerCase('en-US') === normalized)) return canonical
  }
  return ''
}

function schemaDescriptionForPrompt() {
  const entityLines = ENTITY_TYPES.map(([name, description]) => `- ${name}：${description}`)
  const relationLines = RELATION_TYPES.map(([name, description]) => `- ${name}：${description}`)
  return `【实体类型（只能从以下 12 类选择）】\n${entityLines.join('\n')}\n\n` +
    `【关系类型（只能从以下 24 类选择）】\n${relationLines.join('\n')}`
}

function validateDomainPlan(plan) {
  const entities = Array.isArray(plan && plan.entities) ? plan.entities : []
  const entityTypes = Array.isArray(plan && plan.entityTypes) ? plan.entityTypes : []
  const relations = Array.isArray(plan && plan.relations) ? plan.relations : []

  const typedNames = new Set()
  for (const item of entityTypes) {
    if (!item || !entities.includes(item.name)) throw new Error('实体类型映射包含未识别的实体')
    if (!ENTITY_TYPE_SET.has(item.type)) throw new Error(`实体使用了领域 Schema 外的类型: ${item.type}`)
    typedNames.add(item.name)
  }
  if (entities.some(name => !typedNames.has(name))) throw new Error('每个识别实体都必须指定领域实体类型')
  const entityAliases = plan && plan.entityAliases && typeof plan.entityAliases === 'object' ? plan.entityAliases : {}
  for (const [name, aliases] of Object.entries(entityAliases)) {
    if (!entities.includes(name)) throw new Error('实体别名映射包含未识别的实体')
    if (!Array.isArray(aliases) || aliases.some(alias => !String(alias || '').trim())) throw new Error('实体别名格式无效')
  }
  for (const relation of relations) {
    if (!RELATION_TYPE_SET.has(relation)) throw new Error(`关系使用了领域 Schema 外的类型: ${relation}`)
  }

  const params = plan && plan.params && typeof plan.params === 'object' ? plan.params : {}
  for (const [name, rawValue] of Object.entries(params)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue]
    if (/rel(?:ation)?_?types?/i.test(name) && values.some(value => !RELATION_TYPE_SET.has(String(value)))) {
      throw new Error(`关系参数 ${name} 包含领域 Schema 外的类型`)
    }
    if (/^(?:types|entity_?types?|source_?types?|target_?types?)$/i.test(name) &&
        values.some(value => !ENTITY_TYPE_SET.has(String(value)))) {
      throw new Error(`实体类型参数 ${name} 包含领域 Schema 外的类型`)
    }
  }
  return true
}

module.exports = {
  ENTITY_TYPES,
  RELATION_TYPES,
  ENTITY_TYPE_NAMES,
  RELATION_TYPE_NAMES,
  ENTITY_TYPE_SET,
  RELATION_TYPE_SET,
  ENTITY_TYPE_ALIASES,
  RELATION_TYPE_ALIASES,
  aliasesForDomainType,
  canonicalRelationType,
  schemaDescriptionForPrompt,
  validateDomainPlan
}
