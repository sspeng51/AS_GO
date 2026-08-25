/**
 * 日志工具模块
 * 统一日志格式，支持分级输出，便于问题排查
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }
const CURRENT_LEVEL = LOG_LEVELS.INFO

function formatTimestamp() {
  return new Date().toISOString()
}

function formatMessage(level, module, message, data) {
  const ts = formatTimestamp()
  const base = `[${ts}][ChatConv][${level}][${module}] ${message}`
  if (data !== undefined) {
    try {
      const extra = typeof data === 'object' ? JSON.stringify(data) : String(data)
      return `${base} | ${extra.substring(0, 500)}`
    } catch (e) {
      return `${base} | [unserializable]`
    }
  }
  return base
}

const logger = {
  debug(module, message, data) {
    if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) {
      console.log(formatMessage('DEBUG', module, message, data))
    }
  },

  info(module, message, data) {
    if (CURRENT_LEVEL <= LOG_LEVELS.INFO) {
      console.log(formatMessage('INFO', module, message, data))
    }
  },

  warn(module, message, data) {
    if (CURRENT_LEVEL <= LOG_LEVELS.WARN) {
      console.warn(formatMessage('WARN', module, message, data))
    }
  },

  error(module, message, data) {
    if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
      console.error(formatMessage('ERROR', module, message, data))
    }
  }
}

module.exports = logger