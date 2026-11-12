// Binary relevance, with a frozen reference pool when supplied.
// Unknown reference totals are never replaced by the number of relevant hits.
function calculate(review, {referenceRelevantIds=null,contextRelevance=null}={}) {
 const top=review.slice(0,9), relevant=top.filter(r=>r.relevant),first=top.findIndex(r=>r.relevant)
 const reference=referenceRelevantIds===null?null:new Set(referenceRelevantIds)
 const dcg=top.reduce((sum,r,i)=>sum+(r.relevant?1/Math.log2(i+2):0),0)
 const idealCount=reference===null?null:Math.min(9,reference.size)
 const idcg=idealCount===null?null:Array.from({length:idealCount},(_,i)=>1/Math.log2(i+2)).reduce((a,b)=>a+b,0)
 return {
  returned:top.length,relevant:relevant.length,
  recall9:reference?.size?relevant.filter(r=>reference.has(r.id)).length/reference.size:null,
  precision9:relevant.length/9,
  mrr:first<0?0:1/(first+1),
  ndcg9:idcg?dcg/idcg:null,
  hit:Number(first>=0),contextRelevance,
  referenceRelevantCount:reference?.size??null,state:'自动评估完成'
 }
}
module.exports={calculate}
