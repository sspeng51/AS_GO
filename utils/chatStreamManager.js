/**
 * 全局流式输出管理器（单例）
 *
 * 设计动机：
 *   原本流式输出由 pages/index/index.js 持有 setTimeout 句柄，
 *   当用户切到其他 Tab（wx.reLaunch）时 index 页被销毁，onUnload 取消定时器，
 *   导致"切页面后大模型停止思考"。
 *
 * 解决方案：
 *   把流式状态提升到全局单例，独立于页面生命周期。
 *   - manager 持有 currentTask，跑 setTimeout 推进流式
 *   - 通过 subscribe 让任意页面/组件感知状态（实现"全局同步"）
 *   - onFinish 回调由发起页面闭包提供，做持久化（不依赖页面 this）
 *   - 页面销毁后 onProgress 回调静默失败，不影响 manager 运行
 */

const { markdownToHtml } = require('./markdownParser')

class ChatStreamManager {
  constructor() {
    this.task = null              // 当前流式任务
    this._timer = null            // setTimeout 句柄
    this._listeners = []          // 订阅者（页面/组件）
    this._cloudTask = null        // 底层 cloud.callFunction 任务句柄（供 abort）
    this._isAborted = false       // 用户主动 abort 标记
  }

  // ============ 订阅机制 ============
  // 订阅状态变化，立即推送一次当前状态；返回取消订阅函数
  subscribe(cb) {
    this._listeners.push(cb)
    try { cb(this.getState()) } catch (e) {}
    return () => {
      const i = this._listeners.indexOf(cb)
      if (i >= 0) this._listeners.splice(i, 1)
    }
  }

  // 当前状态快照（供 UI 渲染）
  getState() {
    if (!this.task) {
      return { isRunning: false, preview: '', aiMsgId: null, sessionId: null }
    }
    return {
      isRunning: true,
      preview: this.task.preview,
      aiMsgId: this.task.aiMsgId,
      sessionId: this.task.sessionId
    }
  }

  _notify() {
    const state = this.getState()
    this._listeners.forEach(cb => { try { cb(state) } catch (e) {} })
  }

  isRunning() { return !!this.task || !!this._cloudTask }

  // ============ 云函数任务句柄管理 ============
  // 在发起 cloud.callFunction 前调用，记录 task 句柄供 cancel() abort
  setCloudTask(task) {
    this._cloudTask = task
  }

  // 清除云函数任务句柄（云函数返回后调用）
  clearCloudTask() {
    this._cloudTask = null
  }

  // 是否处于"等待云函数返回"阶段（此时打字机尚未启动）
  isWaitingCloud() { return !!this._cloudTask }

  // ============ 启动流式 ============
  // onFinish(finalContent, wasCancelled)：流式结束时的回调（持久化逻辑放这里，不依赖页面 this）
  // onProgress(preview)：每帧回调（更新页面 UI，页面销毁则静默失败）
  startStream({ fullText, aiMsgId, sessionId, onFinish, onProgress }) {
    // 若有正在运行的任务，先取消（不触发 onFinish，因为是替换）
    if (this.task) {
      if (this._timer) { clearTimeout(this._timer); this._timer = null }
      this.task = null
    }

    this.task = {
      aiMsgId,
      sessionId,
      fullText,
      charIndex: 0,
      preview: '',
      onFinish,
      onProgress
    }
    this._notify()
    this._tick()
  }

  // ============ 内部：定时器推进 ============
  _tick() {
    if (!this.task) return
    const t = this.task

    if (t.charIndex >= t.fullText.length) {
      this._finish(false)
      return
    }

    // P1-1: 自适应打字机速度，提升感知流畅度
    // - 首 30 字快速出现（15字/帧，25ms），让用户立刻看到回答开头
    // - 中段稳定输出（12-20字/帧，30-45ms）
    // - 末段稍慢收尾（8-14字/帧，35-55ms），模拟"思考完成"
    const remaining = t.fullText.length - t.charIndex
    const progress = t.charIndex / t.fullText.length
    let batch, interval

    if (t.charIndex < 30) {
      // 首字快速出现
      batch = Math.min(15, remaining)
      interval = 25
    } else if (progress < 0.85) {
      // 中段稳定输出
      batch = Math.min(12 + Math.floor(Math.random() * 9), remaining)
      interval = 30 + Math.floor(Math.random() * 16)
    } else {
      // 末段收尾
      batch = Math.min(8 + Math.floor(Math.random() * 7), remaining)
      interval = 35 + Math.floor(Math.random() * 21)
    }

    t.charIndex += batch
    t.preview = t.fullText.substring(0, t.charIndex)

    // 通知页面更新 UI（页面销毁则静默失败）
    if (t.onProgress) {
      try { t.onProgress(t.preview) } catch (e) {}
    }
    // 通知所有订阅者（tab-bar 等跨页面组件）
    this._notify()

    this._timer = setTimeout(() => this._tick(), interval)
  }

  // ============ 结束/取消 ============
  _finish(wasCancelled) {
    if (!this.task) return
    const t = this.task
    if (this._timer) { clearTimeout(this._timer); this._timer = null }
    this.task = null
    this._notify()

    const finalContent = wasCancelled
      ? t.fullText.substring(0, t.charIndex) + '\n\n_（生成已停止）_'
      : t.fullText

    // 持久化回调（不依赖页面 this，由发起页面闭包提供）
    if (t.onFinish) {
      try { t.onFinish(finalContent, wasCancelled) } catch (e) {
        console.warn('[ChatStreamManager] onFinish 回调异常:', e.message)
      }
    }
  }

  // 用户主动取消（点"停止生成"按钮）
  // 同时处理两种场景：
  // 1. 云函数还在返回中（_cloudTask 存在）→ abort 云函数请求
  // 2. 打字机动画中（this.task 存在）→ 停止 setTimeout
  cancel() {
    this._isAborted = true
    // 场景 1：中止底层云函数请求
    if (this._cloudTask) {
      try {
        if (typeof this._cloudTask.abort === 'function') {
          this._cloudTask.abort()
        } else if (typeof this._cloudTask.destroy === 'function') {
          this._cloudTask.destroy()
        }
      } catch (e) {
        console.warn('[ChatStreamManager] abort cloud task 失败:', e.message)
      }
      this._cloudTask = null
      this._notify()
      return
    }
    // 场景 2：停止打字机动画
    if (this.task) this._finish(true)
  }

  // 是否被用户主动取消（供 index.js 在 catch ABORTED 时判断）
  isAborted() { return this._isAborted }

  // 重置 abort 标记（开始新一轮请求前调用）
  resetAbort() { this._isAborted = false }

  // 重新挂载 onProgress 回调（页面 onShow 恢复时调用，让后续帧能更新新页面）
  // 不传则保持原回调
  attachProgress(cb) {
    if (this.task) this.task.onProgress = cb
  }
}

// 单例
module.exports = new ChatStreamManager()
