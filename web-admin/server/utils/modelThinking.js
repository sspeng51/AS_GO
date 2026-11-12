// GLM-5.3 is always-thinking; even judge requests cannot disable it.
function modelThinking(settings) {
  if (/^glm-5\.3(?:-|$)/i.test(settings.model || '')) return { thinking: { type: 'enabled' }, reasoning_effort: 'low' }
  return settings.thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {}
}
module.exports = { modelThinking }
