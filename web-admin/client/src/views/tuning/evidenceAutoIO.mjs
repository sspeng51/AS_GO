import { workbookBytes } from './answerExport.mjs'
export function parseQuestionRows(rows) {
  if (!rows.length) throw new Error('文件中没有问题')
  const header = rows[0].map(v => String(v).trim())
  const column = header.findIndex(v => /^(问题|题目|question|query|测试问题)$/i.test(v))
  const data = column >= 0 ? rows.slice(1) : rows
  const questions = data.map(row => String(row[column >= 0 ? column : 0] ?? '').trim()).filter(Boolean)
  if (!questions.length || questions.length > 100) throw new Error('请提供1–100道问题；Excel多列表格请使用“问题”列名')
  if (questions.some(q => q.length > 1000)) throw new Error('单题不能超过1000字；请检查选择的问题列')
  return [...new Set(questions)]
}
export function csvRows(text) {
  const rows = [], row = []; let value = '', quoted = false
  for (let i=0;i<text.length;i++) {
    const c=text[i]
    if (c==='"') { if(quoted && text[i+1]==='"'){value+='"';i++}else quoted=!quoted }
    else if(c===',' && !quoted){row.push(value);value=''}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push([...row]);row.length=0;value=''}
    else value+=c
  }
  if(quoted)throw new Error('CSV引号未闭合')
  if(value||row.length){row.push(value);rows.push(row)}
  return rows
}
// Read standard XLSX ZIP parts in the browser, with bounded expanded sizes.
export async function xlsxRows(file) {
  const buffer=await file.arrayBuffer(), bytes=new Uint8Array(buffer), view=new DataView(buffer), decoder=new TextDecoder()
  let end=-1
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50){end=p;break}
  if(end<0)throw new Error('不是有效XLSX文件')
  const count=view.getUint16(end+10,true);let position=view.getUint32(end+16,true),total=0
  if(count>2000)throw new Error('Excel文件结构过大')
  const entries=new Map()
  for(let i=0;i<count;i++){
    if(view.getUint32(position,true)!==0x02014b50)throw new Error('Excel压缩目录损坏')
    const flags=view.getUint16(position+8,true),method=view.getUint16(position+10,true),size=view.getUint32(position+20,true),expanded=view.getUint32(position+24,true),nameSize=view.getUint16(position+28,true),extra=view.getUint16(position+30,true),comment=view.getUint16(position+32,true),offset=view.getUint32(position+42,true)
    const name=decoder.decode(bytes.slice(position+46,position+46+nameSize));position+=46+nameSize+extra+comment
    total+=expanded;if(total>20000000)throw new Error('Excel解压后超过20MB，请仅保留问题列')
    entries.set(name,{flags,method,size,expanded,offset})
  }
  async function xml(name){
    const e=entries.get(name);if(!e)return null
    if(e.flags&1)throw new Error('不支持加密Excel')
    if(view.getUint32(e.offset,true)!==0x04034b50)throw new Error('Excel文件损坏')
    const start=e.offset+30+view.getUint16(e.offset+26,true)+view.getUint16(e.offset+28,true)
    let data=bytes.slice(start,start+e.size)
    if(e.method===8){
      const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let length=0
      try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>e.expanded||length>20000000)throw new Error('Excel解压大小异常');chunks.push(part.value)}}finally{await reader.cancel()}
      data=new Uint8Array(length);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length}
    }else if(e.method!==0)throw new Error('不支持该Excel压缩方式')
    const doc=new DOMParser().parseFromString(decoder.decode(data),'application/xml')
    if(doc.getElementsByTagName('parsererror').length)throw new Error('Excel XML格式错误')
    return doc
  }
  const workbook=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels')
  const first=workbook?.getElementsByTagName('sheet')[0],rid=first?.getAttribute('r:id')
  const target=[...(rels?.getElementsByTagName('Relationship')||[])].find(r=>r.getAttribute('Id')===rid)?.getAttribute('Target')
  if(!target)throw new Error('Excel中没有工作表')
  const path=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`
  const sheet=await xml(path),shared=await xml('xl/sharedStrings.xml')
  if(!sheet)throw new Error('无法读取首个工作表')
  const strings=[...(shared?.getElementsByTagName('si')||[])].map(n=>[...n.getElementsByTagName('t')].map(v=>v.textContent).join(''))
  return [...sheet.getElementsByTagName('row')].map(row=>{
    const values=[]
    for(const cell of row.getElementsByTagName('c')){
      const letters=(cell.getAttribute('r')||'A').match(/^[A-Z]+/)[0];let index=0;for(const c of letters)index=index*26+c.charCodeAt(0)-64
      const type=cell.getAttribute('t'),value=cell.getElementsByTagName('v')[0]?.textContent||''
      values[index-1]=type==='s'?strings[Number(value)]||'':type==='inlineStr'?[...cell.getElementsByTagName('t')].map(n=>n.textContent).join(''):value
    }
    return values
  })
}
export async function importQuestions(file) {
  if(file.size>5000000)throw new Error('文件不能超过5MB')
  const ext=file.name.split('.').pop().toLowerCase()
  if(ext==='xlsx')return parseQuestionRows(await xlsxRows(file))
  const text=(await file.text()).replace(/^\uFEFF/,'')
  if(ext==='csv')return parseQuestionRows(csvRows(text))
  if(ext==='json'){
    const value=JSON.parse(text),rows=Array.isArray(value)?value:value.questions||value.cases
    if(!Array.isArray(rows))throw new Error('JSON须为问题数组或包含questions数组')
    return parseQuestionRows(rows.map(q=>[typeof q==='string'?q:q.query||q.question||q.问题||'']))
  }
  if(ext!=='txt')throw new Error('支持XLSX、CSV、TXT、JSON格式')
  return parseQuestionRows(text.split(/\r?\n/).map(q=>[q.replace(/^\s*\d+[.、．)]\s*/,'')]))
}
export const templateWorkbook=()=>workbookBytes([{name:'问题',rows:[['问题'],['含砷废水处理工艺选择需要哪些水质证据？'],['含砷固体废物稳定化效果应如何验证？']]}])
export function factCounts(item,coverage) {
  if(!Number.isFinite(coverage)||!item?.standard?.paths?.length)return [null,null]
  const paths=item.standard.paths
  // Old multi-path records keep their original best-path denominator.
  if(!item.review)return coverage===0&&item.run?.results?.length===0?[0,paths[0].points.length]:[null,null]
  const candidates=item.review.map((p,i)=>({covered:p.points.filter(v=>v.supported===true).length,total:paths[i].points.length}))
  const best=candidates.reduce((a,b)=>b.covered/b.total>a.covered/a.total?b:a)
  return [best.covered,best.total]
}
export function resultWorkbook(batch,items) {
  const percent=v=>Number.isFinite(v)?{value:v,style:3}:null
  const sheets=[
    {name:'实验汇总',rows:[['实验','模型','检索模式','Top-k','总题数','有效题数','必要证据覆盖率','完整证据链成功率','评价依据'],[batch.name,batch.model,batch.mode,batch.k,batch.questions.length,batch.summary.coverage.samples,percent(batch.summary.coverage.value),percent(batch.summary.chain.value),'模型自动生成标准并评分，非人工金标准']]},
    {name:'逐题结果',rows:[['题号','问题','状态','必要证据覆盖率','完整证据链成功（0或1）','错误','已覆盖事实数','必要事实总数']]},
    {name:'证据与连接标注',rows:[['题号','路径','类型','标准','是否成立','判断理由','证据引用及原文']]},
    {name:'原始记录',rows:[['题号','分段','JSON（按题号及分段顺序拼接）']]}
  ]
  batch.questions.forEach((q,i)=>{const row=batch.rows.find(r=>r.index===i);sheets[1].rows.push([i+1,q,row?.state||'未执行',percent(row?.metrics?.coverage),row?.metrics?.chain??null,row?.error||'',...factCounts(items.find(item=>item.index===i),row?.metrics?.coverage)])})
  for(const item of items){
    item.standard?.paths.forEach((p,pi)=>{
      p.points.forEach((point,j)=>{const r=item.review?.[pi]?.points[j];sheets[2].rows.push([item.index+1,p.name,'必要证据',point.text,r?.supported??null,r?.note||'',JSON.stringify(r?.citations||[])])})
      p.links.forEach((link,j)=>{const r=item.review?.[pi]?.links[j];sheets[2].rows.push([item.index+1,p.name,'必要连接',`${link.from+1} → ${link.to+1}：${link.condition}`,r?.valid??null,r?.reason||'',''])})
    })
    const raw=JSON.stringify(item);for(let offset=0,n=1;offset<raw.length;n++){let end=Math.min(offset+28000,raw.length);if(/[\uD800-\uDBFF]/.test(raw[end-1]))end--;sheets[3].rows.push([item.index+1,n,raw.slice(offset,end)]);offset=end}
  }
  return workbookBytes(sheets)
}
