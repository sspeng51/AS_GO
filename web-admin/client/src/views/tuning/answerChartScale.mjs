// All groups share one domain, including hidden series and separated panels.
export function chartDomain(values, quality = true, zoom = true) {
  const valid = values.filter(Number.isFinite)
  const ceiling = quality ? 1 : Math.max(1, ...valid) * 1.15
  if (!zoom || !valid.length) return { min: 0, max: ceiling }
  const low = Math.min(...valid), high = Math.max(...valid)
  const padding = Math.max((high - low) * 0.15, quality ? 0.025 : ceiling * 0.025)
  const step = quality ? 0.01 : Math.pow(10, Math.floor(Math.log10(ceiling)) - 2)
  return { min: Math.max(0, Math.floor((low - padding) / step) * step), max: Math.min(ceiling, Math.ceil((high + padding) / step) * step) }
}
