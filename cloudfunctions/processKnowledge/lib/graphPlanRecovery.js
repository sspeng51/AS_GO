'use strict'

const { ENTITY_TYPE_NAMES, ENTITY_TYPE_ALIASES, RELATION_TYPE_NAMES, RELATION_TYPE_ALIASES } = require('./domainGraphSchema')
const { CONCEPTS, termAppears, aliasesForCanonical } = require('./bilingualQuery')
const { buildConstrainedCypher, validateReadOnlyCypher, validateCypherAgainstSchema } = require('./cypherSafety')

function canonicalType(value, names, aliases) {
  const normalize = text => String(text || '').normalize('NFKC').trim().toLowerCase().replace(/_/g, '/')
  const key = normalize(value)
  return names.find(name => [name, ...(aliases[name] || [])].some(alias => normalize(alias) === key)) || value
}

function normalizePlanTypes(plan) {
  const entity = value => canonicalType(value, ENTITY_TYPE_NAMES, ENTITY_TYPE_ALIASES)
  const relation = value => canonicalType(value, RELATION_TYPE_NAMES, RELATION_TYPE_ALIASES)
  return {
    ...plan,
    entityTypes: plan.entityTypes.map(item => ({ ...item, type: entity(item.type) })),
    relations: plan.relations.map(relation),
    params: Object.fromEntries(Object.entries(plan.params).map(([name, value]) => {
      const convert = /rel(?:ation)?_?types?/i.test(name) ? relation
        : /^(?:types|entity_?types?|source_?types?|target_?types?)$/i.test(name) ? entity : value => value
      return [name, Array.isArray(value) ? value.map(convert) : convert(value)]
    }))
  }
}

// Recovery deliberately has no inferred category or relation filters. These are
// candidate neighbours, not facts until Neo4j actually returns a matching path.
function entityOnlyPlan(plan, schema, options) {
  const recovered = { ...plan, entityTypes: [], relations: [], params: {}, cypher: '' }
  const template = buildConstrainedCypher(recovered, schema, options)
  const safe = validateReadOnlyCypher(template.cypher, template.params, options)
  validateCypherAgainstSchema(safe.cypher, schema)
  return { ...recovered, ...safe, cypherSource: 'entity_template' }
}

function localEntityPlan(query, schema, options) {
  const normalized = String(query).normalize('NFKC').toLowerCase()
  // Exclude schema category names and prefer specific concepts over substrings.
  const groups = CONCEPTS.filter(group => !ENTITY_TYPE_NAMES.includes(group[0]) &&
    group.some(term => termAppears(normalized, term)))
    .sort((a, b) => b[0].length - a[0].length).slice(0, 3)
  return entityOnlyPlan({
    entities: groups.map(group => group[0]),
    entityAliases: Object.fromEntries(groups.map(group => [group[0], aliasesForCanonical(group).filter(term => !/^[a-z]{1,2}$/i.test(term))])),
    intent: '', plannerModel: '',
  }, schema, options)
}

module.exports = { normalizePlanTypes, entityOnlyPlan, localEntityPlan }
