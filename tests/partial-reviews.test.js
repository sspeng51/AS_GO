const {test}=require('node:test'),assert=require('node:assert/strict')
const {completedReviews}=require('../web-admin/server/utils/partialReviews')
test('中断JSON只恢复完整对象，引用文本内括号和转义不影响边界',()=>{
 const first={id:'R1',result:{claims:[{reason:'括号 } ] { 和引号 " 和反斜线 \\'}]}}
 const second={id:'R2',result:{claims:[]}}
 const raw=JSON.stringify({reviews:[first,second]})
 assert.deepEqual(completedReviews(raw),[first,second])
 const cut=raw.indexOf('{"id":"R2"')+15
 assert.deepEqual(completedReviews(raw.slice(0,cut)),[first])
 assert.deepEqual(completedReviews('{"reviews":[{"id":"R1","result":'),[])
})
test('外层多余括号不会丢弃完整的引用核验字段',()=>{
 const entry={id:'R1',result:{claims:[]},citationReviews:[{id:'D1',score:72}]}
 const raw='{"reviews":['+JSON.stringify(entry)+'},'+JSON.stringify({...entry,id:'R2'})+']}'
 const items=completedReviews(raw)
 assert.equal(items.length,2)
 assert.deepEqual(items[0].citationReviews,entry.citationReviews)
})
