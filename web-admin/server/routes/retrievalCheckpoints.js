const express = require('express')
module.exports = ({read, save, list, requireAdmin, endpoint, validateCase}) => {
  const router = express.Router(), collection = 'rag_retrieval_batches'
  router.get('/', endpoint(async (req,res)=>res.json({batches:(await list(collection,30)).map(b=>({_id:b._id,updatedAt:b.updatedAt,total:b.runs.length}))})))
  router.get('/:id', endpoint(async(req,res)=>res.json({batch:await read(collection,req.params.id)})))
  router.put('/:id', requireAdmin, endpoint(async(req,res)=>{
    const b=req.body, invalid=()=>{throw Object.assign(new Error('批次数据格式无效'),{status:400})}
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(req.params.id)||!Array.isArray(b.runs)||!b.runs.length||b.runs.length>500||!Number.isInteger(b.k)||b.k<1||b.k>20) invalid()
    const seen=new Set()
    const runs=b.runs.map(r=>{
      if(typeof r.query!=='string'||!r.query.trim()||r.query.length>1000||typeof r.targetId!=='string'||!/^([a-zA-Z0-9_-]{1,128})?$/.test(r.targetId)||!/^[a-zA-Z0-9_-]{1,80}$/.test(r.requestId||'')||seen.has(r.requestId))invalid()
      seen.add(r.requestId)
      return {query:r.query,targetId:r.targetId,requestId:r.requestId,_id:r._id||null,k:b.k,batchId:req.params.id,caseId:r.caseId||null,standard:r.standard?validateCase(r.standard):null}
    })
    await save(collection,req.params.id,{runs,k:b.k,questions:runs.map(r=>r.query).filter((q,i,a)=>a.indexOf(q)===i).join('\n'),ids:[...new Set(runs.map(r=>r.targetId))].filter(Boolean).join(','),judgeModel:typeof b.judgeModel==='string'?b.judgeModel.slice(0,80):'glm-4.7',updatedAt:new Date().toISOString(),updatedBy:req.user.username})
    res.json({success:true})
  }))
  return router
}
