function positiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getChatUsageLimits(registered, env = process.env) {
  return registered
    ? {
        daily: positiveInt(env.REGISTERED_DAILY_LIMIT, 100),
        perMinute: positiveInt(env.REGISTERED_PER_MINUTE_LIMIT, 10)
      }
    : {
        daily: positiveInt(env.GUEST_DAILY_LIMIT, 10),
        perMinute: positiveInt(env.GUEST_PER_MINUTE_LIMIT, 5)
      }
}

function evaluateUsage(current, minuteWindow, limits) {
  const dailyCount = Number(current && current.count) || 0
  const sameMinute = current && current.minuteWindow === minuteWindow
  const minuteCount = sameMinute ? (Number(current.minuteCount) || 0) : 0

  if (dailyCount >= limits.daily) {
    return { allowed: false, reason: `今日调用次数已达上限（${limits.daily} 次）` }
  }
  if (minuteCount >= limits.perMinute) {
    return { allowed: false, reason: `调用过于频繁，请稍后再试（每分钟 ${limits.perMinute} 次）` }
  }

  return {
    allowed: true,
    next: {
      count: dailyCount + 1,
      minuteWindow,
      minuteCount: minuteCount + 1
    }
  }
}

module.exports = { positiveInt, getChatUsageLimits, evaluateUsage }
