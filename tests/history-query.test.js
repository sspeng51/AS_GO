const {test}=require('node:test');const assert=require('node:assert/strict');const {listHistory}=require('../web-admin/server/utils/historyQuery')
test('sort-memory fallback scans metadata pages and selects global latest records',async()=>{
 const rows=Array.from({length:205},(_,i)=>({_id:String(i).padStart(4,'0'),updatedAt:String(i).padStart(4,'0')}));let pages=0
 const db={collection(){let offset=0,n=0,field,sort;return {field(f){field=f;return this},orderBy(s){sort=s;return this},skip(i){offset=i;return this},limit(i){n=i;return this},async get(){assert.deepEqual(field,{_id:1,updatedAt:1});if(sort==='updatedAt')throw Error('Sort operation used more than the maximum 33554432 bytes of RAM');pages++;return {data:rows.slice(offset,offset+n)}}}}}
 const result=await listHistory(db,'history',3,{_id:1,updatedAt:1});assert.deepEqual(result.map(r=>r._id),['0204','0203','0202']);assert.equal(pages,3)
})
test('permission failures are not hidden by fallback',async()=>{const db={collection:()=>({field(){return this},orderBy(){return this},limit(){return this},get(){throw Error('permission denied')}})};await assert.rejects(listHistory(db,'history',3,{_id:1}),/permission denied/)})
