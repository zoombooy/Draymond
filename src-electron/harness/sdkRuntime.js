/**
 * SDK 子进程运行时（P3 渐进打通）
 * =================================
 *
 * 与现有 web sidecar 并行存在的实验通道：同一个 DSH home / settings /
 * credentials / patch（因此 P1 工具审批、P2 知识注入插件全部生效），只是改用
 * `dsh --profile sdk` 的 stdio JSON-RPC 而非 web + iframe。
 *
 * 本模块由 harness/index.js 注入依赖（路径、模型、回调），自己不读 config、
 * 不碰 Electron IPC，便于替换与测试。
 */

import { spawn } from 'child_process'
import { JsonRpcLineClient, SDK_METHODS, SDK_NOTIFICATIONS, projectSessionEvent, projectSessionStatus } from './sdkBridge.js'

const SDK_START_TIMEOUT_MS = 90_000

/**
 * 启动 SDK 运行时。
 *
 * @param {object} deps 注入依赖
 * @param {string} deps.cli DSH cli 绝对路径
 * @param {object} deps.paths harnessPaths() 的结果
 * @param {object} deps.model selectedModel() 的结果
 * @param {Function} deps.onEvent 收到 UI 消息/状态时回调 (entry) => void
 * @param {Function} [deps.onOutput] 诊断输出回调 (line) => void
 * @param {Function} [deps.spawnFn] 测试可替换的 spawn
 * @returns {Promise<object>} 运行中的 runtime 句柄
 */
export async function startSdkRuntime(deps) {
  const { cli, paths, model, onEvent } = deps
  if (!cli || !paths || !model || typeof onEvent !== 'function') {
    throw new TypeError('startSdkRuntime requires cli, paths, model and onEvent')
  }
  const spawnFn = typeof deps.spawnFn === 'function' ? deps.spawnFn : spawn
  const emitOutput = typeof deps.onOutput === 'function' ? deps.onOutput : () => {}

  const notifications = []
  const client = new JsonRpcLineClient({
    onNotification: message => {
      if (message.method === SDK_NOTIFICATIONS.SESSION_EVENT) {
        const entry = projectSessionEvent(message.params)
        if (entry) onEvent(entry)
      } else if (message.method === SDK_NOTIFICATIONS.SESSION_STATUS) {
        const entry = projectSessionStatus(message.params)
        if (entry) onEvent(entry)
      }
      notifications.push({ method: message.method, at: Date.now() })
      if (notifications.length > 100) notifications.shift()
    }
  })

  const child = spawnFn(
    process.execPath,
    ['--expose-internals', cli, '--profile', 'sdk', '--patch', paths.patch],
    {
      cwd: paths.workspace,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: paths.home,
        DSH_CWD: paths.workspace,
        DSH_PERMISSION_MODE: 'workspace-write',
        DSH_TELEMETRY_DISABLED: '1',
        DSH_MAX_TOKENS_AS_SUCCESS: '1'
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    }
  )

  const runtime = {
    child,
    client,
    status: 'starting',
    error: null,
    serverInfo: null,
    sessionId: `o-hino-${Date.now().toString(36)}`,
    startedAt: Date.now(),
    notifications,
    exited: false
  }

  let outputBuffer = ''
  const capture = (stream, isStdout) => {
    stream.setEncoding('utf-8')
    stream.on('data', chunk => {
      if (isStdout) {
        client.receive(chunk)
        return
      }
      outputBuffer += chunk
      for (let index = outputBuffer.indexOf('\n'); index !== -1; index = outputBuffer.indexOf('\n')) {
        const line = outputBuffer.slice(0, index).trim()
        outputBuffer = outputBuffer.slice(index + 1)
        if (line) emitOutput(line)
      }
    })
  }
  capture(child.stdout, true)
  capture(child.stderr, false)

  child.once('error', error => {
    runtime.error = error.message
    client.rejectAll(error)
  })
  child.once('exit', (code, signal) => {
    runtime.exited = true
    runtime.status = 'stopped'
    client.rejectAll(new Error(`SDK runtime exited (${signal || code || 'unknown'})`))
    emitOutput(`SDK runtime exited (${signal || code || 'unknown'})`)
  })

  try {
    const init = client.request(SDK_METHODS.INITIALIZE, {
      cwd: paths.workspace,
      provider: 'o-hino',
      model: model.modelName,
      approvalRequests: false,
      capabilities: { userQuestions: false }
    }, SDK_START_TIMEOUT_MS)
    child.stdin.write(init.frame)
    const result = await init.promise
    runtime.serverInfo = result?.serverInfo ?? null
    runtime.status = 'ready'
    return runtime
  } catch (error) {
    runtime.status = 'error'
    runtime.error = error.message || String(error)
    try { child.kill('SIGTERM') } catch {}
    throw error
  }
}

/** 向 SDK 运行时发一条用户消息 */
export async function sdkPrompt(runtime, text, options = {}) {
  if (!runtime || runtime.status !== 'ready' || runtime.exited) throw new Error('SDK runtime is not ready')
  const content = typeof text === 'string' ? text : ''
  if (!content.trim()) throw new Error('SDK prompt text must not be empty')

  const sessionId = typeof options.sessionId === 'string' && options.sessionId ? options.sessionId : runtime.sessionId
  const params = {
    sessionId,
    contentBlocks: [{ type: 'text', text: content }]
  }
  if (typeof options.timeZone === 'string') params.timeZone = options.timeZone

  const request = runtime.client.request(SDK_METHODS.PROMPT, params, options.timeoutMs)
  runtime.child.stdin.write(request.frame)
  return request.promise
}

/** 等待 SDK 会话完成当前轮次 */
export async function sdkWait(runtime, options = {}) {
  if (!runtime || runtime.status !== 'ready' || runtime.exited) throw new Error('SDK runtime is not ready')
  const request = runtime.client.request(SDK_METHODS.WAIT, {
    sessionId: typeof options.sessionId === 'string' && options.sessionId ? options.sessionId : runtime.sessionId
  }, options.timeoutMs)
  runtime.child.stdin.write(request.frame)
  return request.promise
}

/** 优雅关停：先 shutdown 握手，再 SIGTERM → SIGKILL 兜底 */
export async function stopSdkRuntime(runtime) {
  if (!runtime) return
  runtime.status = 'stopping'
  const child = runtime.child

  if (!runtime.exited && child.exitCode === null && !child.killed) {
    try {
      const request = runtime.client.request(SDK_METHODS.SHUTDOWN, undefined, 5000)
      child.stdin.write(request.frame)
      await Promise.race([
        request.promise.catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 5000))
      ])
    } catch {}
  }

  if (child.exitCode === null) {
    try { child.kill('SIGTERM') } catch {}
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        resolve()
      }, 3000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
  runtime.client.rejectAll(new Error('SDK runtime stopped'))
  runtime.status = 'stopped'
}

/** 对外状态快照 */
export function sdkRuntimeStatus(runtime) {
  if (!runtime) return { status: 'idle', sessionId: null, error: null }
  return {
    status: runtime.status,
    sessionId: runtime.sessionId,
    error: runtime.error,
    serverInfo: runtime.serverInfo,
    pending: runtime.client.pendingCount,
    notificationCount: runtime.notifications.length,
    startedAt: runtime.startedAt,
    exited: runtime.exited
  }
}
