// Bound optional progress enrichment; a slow cloud read must not block polling.
function within(promise, ms, fallback) {
  let timer
  return Promise.race([promise, new Promise(resolve => { timer=setTimeout(()=>resolve(fallback),ms) })]).finally(()=>clearTimeout(timer))
}
function coalescedReads(read) {
  const pending=new Map()
  return (collection,id)=>{
    const key=collection+':'+id
    if (!pending.has(key)) {
      const request=Promise.resolve().then(()=>read(collection,id)).finally(()=>pending.delete(key))
      pending.set(key,request)
    }
    return pending.get(key)
  }
}
module.exports={within,coalescedReads}
