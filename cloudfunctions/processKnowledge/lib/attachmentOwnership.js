function ownerSegment(userId) {
  return String(userId || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_')
}

function getCloudPath(fileID) {
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) return ''
  const pathStart = fileID.indexOf('/', 'cloud://'.length)
  return pathStart >= 0 ? fileID.substring(pathStart + 1) : ''
}

function isOwnedFile(fileID, userId, namespace) {
  const segment = ownerSegment(userId)
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(namespace || '')) return false
  return getCloudPath(fileID).startsWith(`${namespace}/${segment}/`)
}

function isOwnedByAny(fileID, userIds, namespace) {
  return (Array.isArray(userIds) ? userIds : [userIds])
    .filter(Boolean)
    .some(userId => isOwnedFile(fileID, userId, namespace))
}

function isOwnedChatAttachment(fileID, userId) {
  return isOwnedFile(fileID, userId, 'chat-attachments')
}

module.exports = { ownerSegment, getCloudPath, isOwnedFile, isOwnedByAny, isOwnedChatAttachment }
