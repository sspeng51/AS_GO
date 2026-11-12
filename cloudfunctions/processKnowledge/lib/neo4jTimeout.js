const MIN_TIMEOUT = 1000
const MAX_TIMEOUT = 30000
const RETRY_TIMEOUT = 15000

function normalizeTimeout(timeout) {
  return Math.min(Math.max(Number(timeout) || RETRY_TIMEOUT, MIN_TIMEOUT), MAX_TIMEOUT)
}

function transactionTimeouts(timeout) {
  const initial = normalizeTimeout(timeout)
  return initial < RETRY_TIMEOUT ? [initial, RETRY_TIMEOUT] : [initial]
}

function isNeo4jTimeout(error) {
  const code = String(error && error.code || '')
  const message = String(error && error.message || '')
  return /Transaction[.]Terminated|TransactionTimedOut|transaction.*timeout/i.test(code) ||
    /transaction has been terminated|has not completed within the timeout|timed?\s*out/i.test(message)
}

module.exports = {
  RETRY_TIMEOUT,
  normalizeTimeout,
  transactionTimeouts,
  isNeo4jTimeout
}
