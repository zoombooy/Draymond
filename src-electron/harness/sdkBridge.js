/**
 * SDK 子进程 JSON-RPC 行帧桥接层
 * ===============================
 *
 * P3 渐进打通的第一块：不启动 dsh web / iframe，而是用 `dsh --profile sdk`
 * 的 stdio JSON-RPC 协议与 Harness 内核对话。默认仍走 web 模式，本模块只在
 * 显式切换到 SDK 实验模式时启用。
 *
 * 本文件刻意不依赖 Electron / child_process / DSH 包，只做三件纯逻辑：
 *   1. 行帧编解码（DSH 的 `JsonRpcLineTransport` 以换行分隔 JSON-RPC 帧）
 *   2. pending 请求的 id 关联、超时与错误归一
 *   3. session.event 通知投影成 UI 可直接渲染的消息条目
 *
 * 进程管理在 sdkRuntime.js，二者分离便于离线单测。
 */

export const SDK_METHODS = Object.freeze({
  INITIALIZE: 'initialize',
  PROMPT: 'session/prompt',
  QUERY: 'session/query',
  WAIT: 'session/wait',
  SHUTDOWN: 'shutdown'
})

export const SDK_NOTIFICATIONS = Object.freeze({
  SESSION_EVENT: 'session.event',
  SESSION_STATUS: 'session.status',
  SUBAGENT_STARTED: 'subagent.started',
  SUBAGENT_FINISHED: 'subagent.finished',
  QUERY_COMPLETED: 'session.query.completed'
})

/** 单帧最大字符数，超过则视为异常帧丢弃，防止畸形输出撑爆内存 */
const MAX_FRAME_CHARS = 2 * 1024 * 1024

/**
 * 把一条 JSON-RPC 请求编码成行帧（含结尾 \n）。
 * @param {number|string} id 请求 id
 * @param {string} method 方法名
 * @param {object} [params] 参数
 * @returns {string}
 */
export function encodeRequest(id, method, params) {
  const frame = { jsonrpc: '2.0', id, method }
  if (params !== undefined) frame.params = params
  return `${JSON.stringify(frame)}\n`
}

/**
 * 解析一行 JSON-RPC 帧。空行、超长行、非法 JSON、非对象都返回 null。
 * @param {string} line
 * @returns {object|null}
 */
export function decodeLine(line) {
  if (typeof line !== 'string') return null
  const value = line.trim()
  if (!value || value.length > MAX_FRAME_CHARS || (value[0] !== '{' && value[0] !== '[')) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** 是否为带 id 的响应帧（result 或 error） */
export function isResponseFrame(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false
  if (!Object.hasOwn(message, 'id')) return false
  return Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')
}

/** 是否为服务端主动推送的通知帧（有 method、无 id） */
export function isNotificationFrame(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false
  return typeof message.method === 'string' && !Object.hasOwn(message, 'id')
}

/** 把 JSON-RPC error 归一成可读 Error */
export function frameError(message) {
  const error = message?.error
  if (!error) return null
  const detail = typeof error.message === 'string' ? error.message : JSON.stringify(error)
  const wrapped = new Error(`SDK JSON-RPC error ${error.code ?? '?'}: ${detail}`)
  wrapped.code = error.code
  wrapped.data = error.data
  return wrapped
}

/**
 * 管理 pending 请求与通知分发的行帧客户端状态机。
 * 不持有任何 I/O：调用方把 stdout 的行喂给 `receiveLine`，把 `encodeRequest`
 * 的结果写进子进程 stdin。
 */
export class JsonRpcLineClient {
  constructor(options = {}) {
    this.nextId = 1
    this.pending = new Map()
    this.onNotification = typeof options.onNotification === 'function' ? options.onNotification : () => {}
    this.defaultTimeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 120_000
    this.buffer = ''
  }

  /** 生成请求帧；调用方负责把返回值写入 stdin */
  buildRequest(method, params, timeoutMs) {
    const id = this.nextId++
    const frame = encodeRequest(id, method, params)
    return { id, frame }
  }

  /**
   * 登记一个请求，返回 resolve(result) / reject(error) 的 promise。
   * 必须在实际写入 stdin 之前调用，避免响应先到而无 pending。
   */
  track(id, timeoutMs) {
    if (this.pending.has(id)) throw new Error(`SDK request id ${id} is already pending`)
    let timer = null
    const promise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`SDK JSON-RPC request ${id} timed out`))
      }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.defaultTimeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
    })
    return promise
  }

  /** 同时生成请求帧并登记 promise */
  request(method, params, timeoutMs) {
    const { id, frame } = this.buildRequest(method, params, timeoutMs)
    const promise = this.track(id, timeoutMs)
    return { id, frame, promise }
  }

  /**
   * 喂入 stdout 的原始数据块，按 \n 切帧。末尾不完整的一段留到下次。
   * @param {string} chunk
   */
  receive(chunk) {
    if (typeof chunk !== 'string') return
    this.buffer += chunk
    if (this.buffer.length > MAX_FRAME_CHARS) {
      this.buffer = ''
      return
    }
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      this.receiveLine(line)
      index = this.buffer.indexOf('\n')
    }
  }

  /** 处理一帧完整 JSON-RPC 消息 */
  receiveLine(line) {
    const message = decodeLine(line)
    if (!message) return

    if (isResponseFrame(message)) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      const error = frameError(message)
      if (error) entry.reject(error)
      else entry.resolve(message.result)
      return
    }

    if (isNotificationFrame(message)) this.onNotification(message)
  }

  /** 拒绝所有 pending（进程退出时调用），防止请求永远挂起 */
  rejectAll(reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason || 'SDK transport closed'))
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
      this.pending.delete(id)
    }
  }

  get pendingCount() {
    return this.pending.size
  }
}

/** 从 ContentBlock 数组取纯文本；与 knowledgeBridge 的行为保持一致 */
export function extractText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/**
 * 把 `session.event` 通知投影成 UI 消息条目。
 * 只保留用户可见的对话文本与状态变化，忽略内部 seq / 工具细节。
 *
 * @param {object} payload 通知 params（{ sessionId, event }）
 * @returns {object|null} { sessionId, role, text, eventType, seq, time }
 */
export function projectSessionEvent(payload) {
  if (!payload || typeof payload !== 'object') return null
  const event = payload.event
  if (!event || typeof event.type !== 'string') return null

  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
  const base = { sessionId, eventType: event.type, seq: event.seq ?? null, time: event.time ?? null }

  if (event.type === 'user/message') {
    const text = extractText(event.data?.content)
    return text ? { ...base, role: 'user', text } : null
  }

  if (event.type === 'agent/inbox/spliced') {
    const inserted = Array.isArray(event.data?.inserted) ? event.data.inserted : []
    const texts = inserted
      .filter(message => message?.source?.kind === 'user')
      .map(message => extractText(message.content))
      .filter(Boolean)
    return texts.length ? { ...base, role: 'user', text: texts.join('\n') } : null
  }

  if (event.type === 'assistant/message') {
    const text = extractText(event.data?.content)
    return text ? { ...base, role: 'assistant', text } : null
  }

  return null
}

/** 从 session.status 通知提取轻量状态文本 */
export function projectSessionStatus(payload) {
  if (!payload || typeof payload !== 'object') return null
  const status = payload.status
  if (!status || typeof status !== 'object') return null
  const kind = typeof status.kind === 'string' ? status.kind : ''
  return {
    sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : '',
    kind,
    detail: typeof status.detail === 'string' ? status.detail : ''
  }
}
