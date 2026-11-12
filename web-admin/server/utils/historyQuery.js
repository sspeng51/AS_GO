const sortMemoryError = error => /sort.*(?:memory|RAM)|sort exceeded|33554432/i.test(error.message || '')
async function listHistory(db, collection, limit, fields) {
  const query = () => {
    const q = db.collection(collection)
    return fields ? q.field(fields) : q
  }
  try { return (await query().orderBy('updatedAt', 'desc').limit(limit).get()).data || [] }
  catch (error) {
    if (!fields || !sortMemoryError(error)) throw error
    // Old collections may lack the updatedAt index. Scan only lightweight
    // metadata in _id order; never load answer/evidence bodies for sorting.
    const latest = []
    for (let offset = 0; offset < 10000; offset += 100) {
      const rows = (await query().orderBy('_id', 'asc').skip(offset).limit(100).get()).data || []
      latest.push(...rows)
      latest.sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a._id).localeCompare(String(b._id)))
      latest.length = Math.min(latest.length, limit)
      if (rows.length < 100) return latest
    }
    throw Object.assign(new Error('历史记录超过兼容查询上限，请为该集合建立 updatedAt 降序索引'), {status:503})
  }
}
module.exports = { listHistory }
