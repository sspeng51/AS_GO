import { answerGroups, answerMetrics, answerTable, knowledgeLabel, metricFor } from './answerMetrics.mjs'

const keys = Object.keys(answerMetrics)
const graded = (key, version) => version === 'anchored-v1' && ['professionalCorrectness', 'conditionApplicability'].includes(key)
const valueCell = (value, key, version) => ({ value: Number.isFinite(value) ? value * (version === 'analytic-100-v2' ? 100 : graded(key, version) ? 4 : 1) : null, style: version === 'analytic-100-v2' || graded(key, version) ? 2 : 3 })
const json = value => JSON.stringify(value ?? null)
export function buildAnswerSheets(runs, paired = false) {
  const sheets = [
    { name: '汇总对比', rows: [['知识库', '模型配置', '评分版本', '实验组', ...keys.flatMap(k => [answerMetrics[k], '有效题数']), '检索＋生成均耗时ms', 'Token总量', '已知Token', 'Token统计状态']] },
    { name: '逐题指标', rows: [['实验ID', '知识库', '问题', '实验组', '生成模型', '评审模型', '评分版本', '指标', '数值', '单位', '分子', '分母', '完整性', '评分状态', '回答是否截断', '检索＋生成耗时ms', '文档检索ms', '图谱检索ms', '专家规范准备ms', '模型生成ms', '思考模式', '思考强度']] },
    { name: '回答与标准', rows: [['实验ID', '知识库', '问题', '实验组', '完整回答', '覆盖标准', '工况标准', '人工参考', '系统提示词', '专家规范', '是否注入专家规范', '错误信息']] },
    { name: '评分依据', rows: [['实验ID', '问题', '实验组', '类型', '序号', '分级分数', '原文', '判断理由', '详细标注JSON']] },
    { name: '引用资料', rows: [['实验ID', '问题', '实验组', '资料ID', '标题', '资料全文']] },
    { name: '模型调用', rows: [['实验ID', '问题', '调用序号', '阶段', '模型', '尝试次数', '开始时间', '耗时ms', '调用成功', '输入Token', '输出Token', 'Token总量', '用量状态', '校验结果', '校验错误', '模型排队ms']] },
    { name: '原始记录', rows: [['实验ID', '分段序号', '分段总数', '完整实验JSON（按序拼接）']] },
    { name: '说明', rows: [['项目', '内容'], ['导出时间', new Date().toISOString()], ['汇总口径', paired ? '每项指标仅统计五组均有有效评分的共同题目，逐题等权平均' : '各组有效评分逐题等权平均'], ['单位', 'v2五项指标均为0–100分；v1专业与工况仍为0–4分，其余保留比例；不同版本不可混评。单元格为真实数值。'], ['结论依据充分性', 'v2按支持程度0–100逐结论平均；v1为有依据结论比例，由1减无依据比例得到。未知值为空。'], ['缺失值', '空白表示未知或未完成，不能当作零。截断回答保留逐题原始分数，但不计入汇总。'], ['共享Token', '标准制定和集中评审只在共享行计一次；未知usage不按0补齐。图谱内部Token上游未返回，不计入此统计。'], ['原始记录', '含检索诊断、引用、评分历史、参数、调用输出及所有已保存字段；同一实验按分段序号拼接可恢复完整JSON。'], ['耗时口径', '各组依赖检索与专家准备、模型生成耗时之和（含失败重试），不含评审、排队和人工等待。共享检索计入各依赖组，不能跨组求和。旧记录无完整计时则为空。'], ['报告类型', '导出时的数据快照；汇总数值与网页口径一致。']] }
  ]
  sheets.push({ name: '阶段耗时', rows: [['实验ID', '问题', '检索准备ms', '生成阶段ms', '标准制定ms', '评审阶段ms', '说明']] })
  for (const row of answerTable(runs, paired)) sheets[0].rows.push([row.knowledgeLabel, row.configLabel, row.scoringVersion || 'legacy', row.label, ...keys.flatMap(k => [valueCell(row.metrics[k].value, k, row.scoringVersion), row.shared ? null : row.metrics[k].samples]), row.generationMs, row.tokens, row.knownTokens, row.missingUsage ? '不完整' : '完整'])
  for (const run of runs) {
    sheets.at(-1).rows.push([run._id, run.query, run.phaseTimings?.prepare, run.phaseTimings?.generate, run.phaseTimings?.rubric, run.phaseTimings?.judge, '阶段累计墙钟耗时，含执行排队及补试；不含暂停间隔。并行题目不可相加作为批次耗时；旧记录缺项为空。'])
    for (const [group, label] of Object.entries(answerGroups)) {
      const variant = run.variants[group] || {}
      for (const key of keys) {
        const m = metricFor(variant, key)
        sheets[1].rows.push([run._id, knowledgeLabel(run), run.query, label, run.generation?.model, run.judgeModel, run.scoringVersion || 'legacy', answerMetrics[key], valueCell(m?.value, key, run.scoringVersion), run.scoringVersion === 'analytic-100-v2' ? '分（0–100）' : graded(key, run.scoringVersion) ? '分（0–4）' : '比例（0–1）', m?.numerator, m?.denominator, m?.complete === false ? '不完整' : m ? '已保存' : '未评分', variant.judge?.status, variant.finishReason === 'length', variant.timings?.totalMs, variant.timings?.documentMs, variant.timings?.graphMs, variant.timings?.expertMs, variant.timings?.modelMs, variant.thinking, variant.reasoningEffort])
      }
      sheets[2].rows.push([run._id, knowledgeLabel(run), run.query, label, variant.answer, json(run.rubric?.points), json(run.rubric?.conditions), run.reference, run.generation?.systemPrompt, run.expert?.context, variant.expertApplied, variant.error || run.stageErrors?.[group] || run.lastError])
      for (const type of ['claims', 'conditions', 'coverage']) (variant.judge?.[type] || []).forEach((item, i) => sheets[3].rows.push([run._id, run.query, label, { claims: '技术结论', conditions: '工况', coverage: '覆盖点' }[type], i + 1, item.score, item.quote, item.reason, json(item)]))
      for (const source of variant.sources || []) sheets[4].rows.push([run._id, run.query, label, source.id, source.title, source.content])
      for (const [i, item] of (variant.judge?.citationReviews || []).entries()) sheets[3].rows.push([run._id, run.query, label, '独立引用核验', i + 1, item.score, item.quoteId, item.reason, json(item)])
    }
    ;(run.calls || []).forEach((call, i) => sheets[5].rows.push([run._id, run.query, i + 1, call.stage, call.model, call.attempt, call.startedAt, call.latencyMs, call.success, call.usage?.prompt_tokens, call.usage?.completion_tokens, call.usage?.total_tokens, Number.isFinite(call.usage?.total_tokens) ? '完整' : '未知', call.validated, call.validationError, call.queueMs]))
    const parts = chunks(json(run))
    parts.forEach((part, i) => sheets[6].rows.push([run._id, i + 1, parts.length, part]))
  }
  return sheets
}
function chunks(text) {
  const result = []
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 30000, text.length)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
    result.push(text.slice(start, end)); start = end
  }
  return result
}
const xml = value => String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const column = n => { let result = ''; for (n++; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result }
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

// Minimal OOXML snapshot writer. Explicit inline strings prevent formulas or
// external links embedded in questions/model output from executing in Excel.
export function workbookBytes(input) {
  const long = { name: '长文本', rows: [['文本ID', '原始位置', '分段序号', '分段总数', '内容（按序拼接）']] }
  let textId = 0
  const sheets = input.map(sheet => ({ ...sheet, rows: sheet.rows.map((row, r) => row.map((cell, c) => {
    if (typeof cell !== 'string' || cell.length <= 30000) return cell
    const id = `T${++textId}`, parts = chunks(cell)
    parts.forEach((part, i) => long.rows.push([id, `${sheet.name}!${column(c)}${r + 1}`, i + 1, parts.length, part]))
    return `全文见“长文本” ${id}`
  })) }))
  if (long.rows.length > 1) sheets.push(long)
  const files = []
  const add = (name, data) => files.push({ name, data: declaration + data })
  add('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  add('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  add('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  add('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  add('xl/styles.xml', `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243B53"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4">${[0, 1, 2, 3].map(i => `<xf numFmtId="${i === 2 ? 2 : i === 3 ? 164 : 0}" fontId="${i === 1 ? 1 : 0}" fillId="${i === 1 ? 2 : 0}" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
  sheets.forEach((sheet, i) => {
    const count = Math.max(...sheet.rows.map(row => row.length))
    if (sheet.rows.length > 1048576 || count > 16384) throw new Error('数据量超过Excel单工作表限制')
    const body = sheet.rows.map((row, r) => `<row r="${r + 1}"${r === 0 ? ' ht="36" customHeight="1"' : ''}>${row.map((cell, c) => {
      const value = cell && typeof cell === 'object' ? cell.value : cell
      if (value == null || typeof value === 'number' && !Number.isFinite(value)) return ''
      const attrs = `r="${column(c)}${r + 1}" s="${r === 0 ? 1 : cell?.style || 0}"`
      return typeof value === 'number' ? `<c ${attrs}><v>${value}</v></c>` : typeof value === 'boolean' ? `<c ${attrs} t="b"><v>${Number(value)}</v></c>` : `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
    }).join('')}</row>`).join('')
    add(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${sheet.rows[0].map((name, c) => `<col min="${c + 1}" max="${c + 1}" width="${/全文|回答|原文|理由|JSON|内容|问题|标准|提示词|专家规范/.test(name) ? 55 : 22}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${column(count - 1)}${sheet.rows.length}"/></worksheet>`)
  })
  return zip(files)
}
function zip(files) {
  const encoder = new TextEncoder(), parts = [], directory = []
  let offset = 0
  const header = length => { const bytes = new Uint8Array(length); return { bytes, view: new DataView(bytes.buffer) } }
  for (const file of files) {
    const name = encoder.encode(file.name), data = encoder.encode(file.data)
    let crc = 0xffffffff
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0) }
    crc = (crc ^ 0xffffffff) >>> 0
    const local = header(30), central = header(46)
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x800, true); local.view.setUint16(12, 33, true)
    local.view.setUint32(14, crc, true); local.view.setUint32(18, data.length, true); local.view.setUint32(22, data.length, true); local.view.setUint16(26, name.length, true)
    central.view.setUint32(0, 0x02014b50, true); central.view.setUint16(4, 20, true); central.view.setUint16(6, 20, true); central.view.setUint16(8, 0x800, true); central.view.setUint16(14, 33, true)
    central.view.setUint32(16, crc, true); central.view.setUint32(20, data.length, true); central.view.setUint32(24, data.length, true); central.view.setUint16(28, name.length, true); central.view.setUint32(42, offset, true)
    parts.push(local.bytes, name, data); directory.push(central.bytes, name); offset += 30 + name.length + data.length
  }
  const size = directory.reduce((n, bytes) => n + bytes.length, 0), end = header(22)
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, files.length, true); end.view.setUint16(10, files.length, true); end.view.setUint32(12, size, true); end.view.setUint32(16, offset, true)
  const result = new Uint8Array(offset + size + 22); let cursor = 0
  for (const bytes of [...parts, ...directory, end.bytes]) { result.set(bytes, cursor); cursor += bytes.length }
  return result
}
export function exportAnswerWorkbook(runs, paired) { return workbookBytes(buildAnswerSheets(runs, paired)) }
