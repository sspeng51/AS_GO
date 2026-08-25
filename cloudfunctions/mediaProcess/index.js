/**
 * mediaProcess 云函数
 * 功能: 语音转文字、文件文本提取
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function ownerSegment(userId) {
  return String(userId || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_')
}

function getCloudPath(fileID) {
  const pathStart = String(fileID || '').indexOf('/', 'cloud://'.length)
  return pathStart >= 0 ? fileID.substring(pathStart + 1) : ''
}

exports.main = async (event, context) => {
  const { action, data = {} } = (event && typeof event === 'object') ? event : {}

  console.log(`[mediaProcess] action=${action}`)

  try {
    switch (action) {
      case 'speechToText':
        return await handleSpeechToText(data, context)
      default:
        return { success: false, error: `未知操作: ${action}` }
    }
  } catch (err) {
    console.error('[mediaProcess] 异常:', err.message)
    return { success: false, error: '服务器内部错误，请稍后重试' }
  }
}

/**
 * 语音转文字
 * 优先使用腾讯云 ASR，未配置时使用降级方案
 */
async function handleSpeechToText(data, context) {
  const { fileID } = data

  if (!fileID || typeof fileID !== 'string' || !/^cloud:\/\//.test(fileID)) {
    return { success: false, error: '缺少音频文件ID' }
  }

  let openid = ''
  try {
    const wxContext = cloud.getWXContext()
    openid = wxContext.OPENID || wxContext.openid || (context && (context.OPENID || context.openid)) || ''
  } catch (e) {}
  if (!openid) return { success: false, error: '用户身份识别失败' }

  const userResult = await db.collection('users').where({ openid }).limit(1).get().catch(() => ({ data: [] }))
  if (!userResult.data || userResult.data.length === 0) {
    return { success: false, error: '请登录后使用语音识别功能' }
  }
  const allowedPrefixes = [userResult.data[0]._id, openid]
    .filter(Boolean)
    .map(id => `voice/${ownerSegment(id)}/`)
  if (!allowedPrefixes.some(prefix => getCloudPath(fileID).startsWith(prefix))) {
    return { success: false, error: '无权访问该音频，请重新录制' }
  }

  // 尝试腾讯云 ASR
  const secretId = process.env.TENCENT_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY

  if (secretId && secretKey) {
    try {
      // 下载音频文件到临时路径
      const downloadRes = await cloud.downloadFile({ fileID })
      const audioBuffer = downloadRes.fileContent
      if (!audioBuffer || audioBuffer.length === 0) {
        return { success: false, error: '音频文件为空' }
      }
      if (audioBuffer.length > 5 * 1024 * 1024) {
        return { success: false, error: '音频文件不能超过 5MB' }
      }

      // 调用腾讯云 ASR API
      const text = await callTencentASR(audioBuffer, secretId, secretKey)
      if (text) {
        return { success: true, text, method: 'tencent_asr' }
      }
    } catch (err) {
      console.warn('[mediaProcess] 腾讯云ASR调用失败:', err.message)
    }
  }

  // 降级：返回提示信息
  return {
    success: false,
    error: '语音识别服务暂未配置，请使用文字输入',
    hint: '需要配置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY 环境变量'
  }
}

/**
 * 调用腾讯云一句话识别 API
 */
async function callTencentASR(audioBuffer, secretId, secretKey) {
  const crypto = require('crypto')
  const https = require('https')

  // 将音频转为 base64
  const base64Data = audioBuffer.toString('base64')

  const timestamp = Math.floor(Date.now() / 1000)
  const service = 'asr'
  const host = 'asr.tencentcloudapi.com'
  const action = 'SentenceRecognition'
  const version = '2019-06-14'
  const region = 'ap-guangzhou'

  // 签名
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const signedHeaders = 'content-type;host'
  const payload = JSON.stringify({
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: '16k_zh',
    SourceType: 1,
    VoiceFormat: 'mp3',
    UsrAudioKey: 'miniapp_audio',
    Data: base64Data,
    DataLen: audioBuffer.length
  })

  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex')
  const canonicalRequest = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\n${signedHeaders}\n${hashedPayload}`
  const algorithm = 'TC3-HMAC-SHA256'
  const credentialScope = `${date}/${service}/tc3_request`
  const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonical}`

  const kDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest()
  const kService = crypto.createHmac('sha256', kDate).update(service).digest()
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest()
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Host': host,
        'Authorization': authorization,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': timestamp,
        'X-TC-Region': region
      },
      timeout: 20000
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          if (result.Response && result.Response.Result) {
            resolve(result.Response.Result)
          } else if (result.Response && result.Response.Error) {
            reject(new Error(result.Response.Error.Message))
          } else {
            reject(new Error('ASR返回异常'))
          }
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('ASR 请求超时')))
    req.write(payload)
    req.end()
  })
}
