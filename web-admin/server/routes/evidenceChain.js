const express = require('express')
const crypto = require('crypto')
const {validateExperiment,validateReview,report}=require('../utils/evidenceChain')
module.exports=({read,save,list,requireAdmin,endpoint})=>{
  const router=express.Router(), collection='rag_evidence_experiments'
  const locks=new Set()
  const mutate=fn=>endpoint(async(req,res)=>{
    const id=req.params.id
    if(locks.has(id))throw Object.assign(new Error('实验正在保存，请稍后重试'),{status:409})
    locks.add(id);try{await fn(req,res)}finally{locks.delete(id)}
  })
  router.get('/',endpoint(async(req,res)=>res.json({experiments:(await list(collection,100)).map(e=>({_id:e._id,name:e.name,updatedAt:e.updatedAt,total:e.cases.length}))})))
  router.post('/',requireAdmin,endpoint(async(req,res)=>{
    const value={...validateExperiment(req.body),entries:[],updatedAt:new Date().toISOString(),updatedBy:req.user.username}
    const id=crypto.randomUUID();await save(collection,id,value);res.json({experiment:report({...value,_id:id})})
  }))
  router.get('/:id',endpoint(async(req,res)=>res.json({experiment:report(await read(collection,req.params.id))})))
  router.post('/:id/runs',requireAdmin,mutate(async(req,res)=>{
    const exp=await read(collection,req.params.id),index=req.body.caseIndex
    if(!Number.isInteger(index)||!exp.cases[index])throw Object.assign(new Error('问题编号无效'),{status:400})
    if(exp.entries.some(e=>e.caseIndex===index))throw Object.assign(new Error('该问题已有运行，请新建实验重跑，保留原始复核'),{status:409})
    const run=await read('rag_eval_runs',req.body.runId),standard=exp.cases[index]
    if(run.query!==standard.query||run.k!==exp.k||run.retrievalMode!==exp.mode||run.requestedKnowledgeId!==exp.knowledgeId)throw Object.assign(new Error('运行的问题或检索参数与实验不一致'),{status:400})
    exp.entries.push({caseIndex:index,standard:structuredClone(standard),run,review:null})
    exp.updatedAt=new Date().toISOString();exp.updatedBy=req.user.username
    const {_id,...data}=exp;await save(collection,_id,data);res.json({experiment:report(exp)})
  }))
  router.put('/:id/review/:index',requireAdmin,mutate(async(req,res)=>{
    const exp=await read(collection,req.params.id),entry=exp.entries.find(e=>e.caseIndex===Number(req.params.index))
    if(!entry)throw Object.assign(new Error('请先运行该题'),{status:400})
    if((req.body.reviewedAt||null)!==(entry.reviewedAt||null))throw Object.assign(new Error('复核已被更新，请重新打开实验再复核'),{status:409})
    entry.review=validateReview(entry.standard.paths,req.body.paths,entry.run)
    entry.reviewedBy=req.user.username;entry.reviewedAt=new Date().toISOString()
    exp.updatedAt=entry.reviewedAt;const {_id,...data}=exp;await save(collection,_id,data)
    res.json({experiment:report(exp)})
  }))
  return router
}
