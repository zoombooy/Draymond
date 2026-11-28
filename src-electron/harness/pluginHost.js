/**
 * o-hino 轻量插件宿主
 * ====================
 *
 * 只借鉴 DSH 的插件契约，不加载 DSH 运行时、不依赖 iframe：
 *   - 插件导出 name / inject / apply(ctx, config)
 *   - ctx.on(event, handler) 支持普通派发与 waterfall 钩子
 *   - ctx.tools.execute({ calls, signal, agent }) 批量执行工具
 *   - agent.inject(message) 把消息排进下一次 pre-step
 *
 * 宿主本身不碰 Electron IPC；由 harness/index.js 注入回调和工具实现，
 * 这样核心逻辑可以用 node:test 离线验证。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import {
  addBundle as addBundleEntry,
  normalizeBundleSpec,
  removeBundle as removeBundleEntry,
  sanitizeRegistry,
  setBundleEnabled as setBundleEnabledEntry
} from './bundleRegistry.js'

const APPROVAL_TIMEOUT_MS = 60_000

/** 把路径 / 包名归一成可直接 import() 的 spec */
export function resolvePluginSpec(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('插件路径或包名不能为空')
  }
  const value = input.trim()
  if (/^(file:|data:|node:)/i.test(value)) return value

  const normalized = value.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) {
    return pathToFileURL(path.resolve(value)).href
  }
  return value
}

/** 加载本地文件或 npm 包插件 */
export async function loadPluginModule(spec) {
  return import(resolvePluginSpec(spec))
}

function errorResult(message) {
  return {
    result: {
      isError: true,
      content: [{ type: 'text', text: String(message) }]
    }
  }
}

function textResult(text) {
  return {
    result: {
      content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text) }]
    }
  }
}

/**
 * 事件总线。waterfall 语义与 DSH 一致：handler(payload, next)，
 * next() 返回下一个 handler 的决策；返回 undefined 时继续向下传递。
 */
function createBus(host) {
  const handlers = new Map()
  let seq = 0

  const remove = (event, id) => {
    const list = handlers.get(event)
    if (!list) return
    const next = list.filter(item => item.id !== id)
    if (next.length) handlers.set(event, next)
    else handlers.delete(event)
  }

  return {
    on(event, handler) {
      if (typeof event !== 'string' || !event || typeof handler !== 'function') return () => {}
      const entry = { id: `h${++seq}`, event, handler, owner: host.currentOwner || 'system' }
      handlers.set(event, [...(handlers.get(event) || []), entry])
      return () => remove(event, entry.id)
    },
    clearOwner(owner) {
      for (const [event, list] of [...handlers.entries()]) {
        for (const entry of list) {
          if (entry.owner === owner) remove(event, entry.id)
        }
      }
    },
    clear() {
      handlers.clear()
    },
    snapshot() {
      const out = []
      for (const [event, list] of handlers.entries()) {
        for (const entry of list) out.push({ ...entry })
      }
      return out
    },
    countForOwner(owner) {
      return this.snapshot().filter(entry => entry.owner === owner).length
    },
    async emit(event, ...args) {
      const list = (handlers.get(event) || []).slice()
      const results = []
      for (const entry of list) {
        try {
          results.push(await entry.handler(...args))
        } catch (error) {
          host.logger?.warn?.(`[PluginHost] ${entry.owner}/${event} 失败: ${error.message}`)
          results.push(null)
        }
      }
      return results
    },
    waterfall(event, payload, initial) {
      const chain = (handlers.get(event) || []).slice()
      let index = 0
      const next = async () => {
        if (index >= chain.length) return initial
        const entry = chain[index++]
        let advanced = false
        let downstream = initial

        const advance = async () => {
          advanced = true
          downstream = await next()
          return downstream
        }

        try {
          const decision = await entry.handler(payload, advance)
          if (decision !== undefined) return decision
        } catch (error) {
          host.logger?.warn?.(`[PluginHost] ${entry.owner}/${event} 失败: ${error.message}`)
        }
        if (!advanced) downstream = await next()
        return downstream === undefined ? initial : downstream
      }
      return next()
    }
  }
}

function createAgents(host) {
  const agents = new Map()
  let current = null

  const makeAgent = (id, meta = {}) => {
    const agent = {
      id: String(id || `agent-${randomUUID()}`),
      meta,
      injected: [],
      inject(message) {
        this.injected.push(message)
        host.bus.emit('agent/injected', { agent: this, message }).catch(() => {})
      },
      takeInjected() {
        const values = this.injected.slice()
        this.injected.length = 0
        return values
      }
    }
    return agent
  }

  return {
    get: id => agents.get(id) || null,
    getOrCreate(id) {
      const key = String(id || 'default')
      if (!agents.has(key)) agents.set(key, makeAgent(key))
      current = agents.get(key)
      return current
    },
    create(id, meta) {
      const agent = makeAgent(id, meta)
      agents.set(agent.id, agent)
      current = agent
      return agent
    },
    currentInitiator: () => current,
    setCurrent(id) {
      current = agents.get(id) || null
      return current
    },
    list: () => [...agents.values()].map(agent => ({
      id: agent.id,
      injected: agent.injected.length
    }))
  }
}

function createTools(host, bus) {
  const definitions = new Map()

  return {
    register(name, implementation, owner = host.currentOwner || 'system') {
      if (typeof name !== 'string' || !name) throw new Error('工具名不能为空')
      definitions.set(name, {
        name,
        owner,
        description: implementation?.description || '',
        handler: implementation?.handler
      })
      return () => definitions.delete(name)
    },
    unregister(name) {
      definitions.delete(name)
    },
    unregisterOwner(owner) {
      for (const [name, def] of [...definitions.entries()]) {
        if (def.owner === owner) definitions.delete(name)
      }
    },
    get(name) {
      return definitions.get(name) || null
    },
    list() {
      return [...definitions.values()].map(def => ({
        name: def.name,
        description: def.description,
        owner: def.owner
      }))
    },
    async execute({ calls = [], signal, agent } = {}) {
      const results = []
      for (const call of Array.isArray(calls) ? calls : []) {
        if (signal?.aborted) {
          results.push(errorResult('工具执行已取消'))
          continue
        }

        const name = call?.name
        const definition = definitions.get(name)
        if (!definition || typeof definition.handler !== 'function') {
          results.push(errorResult(`未注册工具：${name || '(空)'}`))
          continue
        }

        const execution = { ...call, agent }
        const decision = await bus.waterfall('tools/pre-execute', execution, null)
        if (decision?.kind === 'ask') {
          const approved = await host.requestApproval({
            id: randomUUID(),
            name,
            reason: decision.reason || `工具 ${name} 需要确认后执行`,
            execution
          })
          if (!approved) {
            results.push(errorResult('用户拒绝或超时，工具未执行'))
            continue
          }
        } else if (decision?.kind && !['enter', 'allow'].includes(decision.kind)) {
          results.push(errorResult(decision.reason || '插件阻止了工具执行'))
          continue
        }

        let args = {}
        try {
          args = typeof call.arguments === 'string'
            ? JSON.parse(call.arguments || '{}')
            : (call.arguments || {})
        } catch (error) {
          results.push(errorResult(`工具参数不是合法 JSON：${error.message}`))
          continue
        }

        try {
          const output = await definition.handler(args, host.context, { agent, signal })
          results.push(textResult(output))
        } catch (error) {
          results.push(errorResult(`工具执行失败：${error.message}`))
        }
      }
      return { results }
    }
  }
}

export class PluginHost {
  constructor(options = {}) {
    this.registryFile = options.registryFile || ''
    this.builtins = Array.isArray(options.builtins) ? options.builtins : []
    this.toolDefinitions = Array.isArray(options.tools) ? options.tools : []
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {}
    this.logger = options.logger || console
    this.contextConfig = options.contextConfig || {}

    this.currentOwner = null
    this.started = false
    this.loaded = new Map()
    this.approvals = new Map()
    this.errors = new Map()

    this.bus = createBus(this)
    this.agents = createAgents(this)
    this.tools = createTools(this, this.bus)
    this.context = {
      on: this.bus.on,
      emit: this.bus.emit,
      emitWaterfall: this.bus.waterfall,
      tools: this.tools,
      agents: this.agents,
      logger: this.logger,
      config: this.contextConfig,
      host: { name: 'o-hino-plugin-host', version: '0.1.0' }
    }

    for (const definition of this.toolDefinitions) {
      this.tools.register(definition.name, definition, 'system')
    }
  }

  readRegistry() {
    if (!this.registryFile || !fs.existsSync(this.registryFile)) return []
    try {
      return sanitizeRegistry(JSON.parse(fs.readFileSync(this.registryFile, 'utf-8')))
    } catch (error) {
      this.logger?.warn?.(`[PluginHost] 忽略损坏的插件注册表：${error.message}`)
      return []
    }
  }

  writeRegistry(registry) {
    const clean = sanitizeRegistry(registry)
    if (!this.registryFile) return clean
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true })
    fs.writeFileSync(this.registryFile, `${JSON.stringify(clean, null, 2)}\n`, 'utf-8')
    return clean
  }

  allEntries() {
    const builtins = this.builtins.map(item => ({
      id: item.id,
      label: item.label || item.id,
      spec: item.spec,
      kind: 'builtin',
      enabled: item.enabled !== false,
      config: item.config || {},
      inject: item.inject || []
    }))
    const users = this.readRegistry().map(item => ({
      ...item,
      kind: 'user',
      config: item.config || {},
      inject: item.inject || []
    }))
    return [...builtins, ...users]
  }

  async start() {
    if (this.started) return this.list()
    this.started = true
    await this.reload()
    return this.list()
  }

  async stop() {
    this.unloadAll()
    this.bus.clear()
    this.started = false
  }

  unloadAll() {
    for (const [id, record] of [...this.loaded.entries()]) {
      try {
        if (typeof record.dispose === 'function') record.dispose()
      } catch (error) {
        this.logger?.warn?.(`[PluginHost] ${id} 卸载失败：${error.message}`)
      }
      this.bus.clearOwner(id)
      this.tools.unregisterOwner(id)
      this.loaded.delete(id)
    }
  }

  async reload() {
    this.unloadAll()
    this.errors.clear()
    for (const entry of this.allEntries()) {
      if (entry.enabled === false) continue
      try {
        await this.loadEntry(entry)
      } catch (error) {
        this.errors.set(entry.id, error.message || String(error))
        this.logger?.warn?.(`[PluginHost] 加载 ${entry.id} 失败：${error.message}`)
      }
    }
    return this.list()
  }

  async loadEntry(entry) {
    const before = new Set(this.bus.snapshot().map(item => item.id))
    this.currentOwner = entry.id
    try {
      const module = await loadPluginModule(entry.spec)
      if (typeof module.apply !== 'function') {
        throw new Error('插件必须导出 apply(ctx, config)')
      }
      const result = await module.apply(this.context, entry.config || {})
      const hooks = this.bus.snapshot()
        .filter(item => !before.has(item.id) && item.owner === entry.id)
        .map(item => item.event)
      const dispose = typeof result === 'function'
        ? result
        : (typeof result?.dispose === 'function' ? result.dispose : null)
      this.loaded.set(entry.id, {
        entry,
        hooks: [...new Set(hooks)],
        dispose,
        loadedAt: Date.now()
      })
    } finally {
      this.currentOwner = null
    }
  }

  list() {
    return this.allEntries().map(entry => {
      const record = this.loaded.get(entry.id)
      return {
        id: entry.id,
        label: entry.label,
        spec: entry.spec,
        kind: entry.kind,
        enabled: entry.enabled !== false,
        loaded: Boolean(record),
        hooks: record?.hooks || [],
        tools: this.tools.list().filter(item => item.owner === entry.id).map(item => item.name),
        error: this.errors.get(entry.id) || null
      }
    })
  }

  listTools() {
    return this.tools.list()
  }

  emit(event, ...args) {
    return this.bus.emit(event, ...args)
  }

  waterfall(event, payload, initial) {
    return this.bus.waterfall(event, payload, initial)
  }

  publicApproval(pending) {
    return {
      id: pending.id,
      name: pending.name,
      reason: pending.reason,
      status: pending.status,
      tool: pending.execution?.name || pending.name
    }
  }

  pendingApprovals() {
    return [...this.approvals.values()].map(pending => this.publicApproval(pending))
  }

  requestApproval(input) {
    return new Promise(resolve => {
      const pending = { ...input, status: 'pending', resolve }
      this.approvals.set(pending.id, pending)
      pending.timer = setTimeout(() => this.approve(pending.id, false, true), APPROVAL_TIMEOUT_MS)
      this.onEvent('harness-plugin-approval', this.publicApproval(pending))
    })
  }

  approve(id, approved, expired = false) {
    const pending = this.approvals.get(id)
    if (!pending) return false
    clearTimeout(pending.timer)
    this.approvals.delete(id)
    pending.status = expired ? 'expired' : (approved ? 'approved' : 'denied')
    pending.resolve(Boolean(approved) && !expired)
    this.onEvent('harness-plugin-approval-resolved', this.publicApproval(pending))
    return true
  }

  async addBundle(input) {
    const spec = normalizeBundleSpec(typeof input === 'string' ? input : input?.spec)
    const label = typeof input === 'object' && typeof input.label === 'string' ? input.label : ''
    const result = addBundleEntry(this.readRegistry(), spec, { label })
    this.writeRegistry(result.registry)
    await this.reload()
    return { ...result, plugins: this.list() }
  }

  async removeBundle(id) {
    const result = removeBundleEntry(this.readRegistry(), id)
    this.writeRegistry(result.registry)
    await this.reload()
    return { ...result, plugins: this.list() }
  }

  async toggleBundle(id, enabled) {
    const result = setBundleEnabledEntry(this.readRegistry(), id, Boolean(enabled))
    if (!result.bundle) throw new Error(`插件不存在：${id}`)
    this.writeRegistry(result.registry)
    await this.reload()
    return { ...result, plugins: this.list() }
  }

  async invokeTool(name, args = {}) {
    const result = await this.tools.execute({
      calls: [{
        type: 'tool-call',
        id: randomUUID(),
        name,
        arguments: JSON.stringify(args || {})
      }]
    })
    const settled = result?.results?.[0]?.result || {}
    return {
      isError: settled.isError === true,
      text: settled.content?.[0]?.text || ''
    }
  }
}

export function createPluginContext(options = {}) {
  const host = new PluginHost(options)
  return { host, ctx: host.context }
}
