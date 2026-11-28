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
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import * as tar from 'tar'
import yaml from 'js-yaml'
import {
  addBundle as addBundleEntry,
  normalizeBundleSpec,
  removeBundle as removeBundleEntry,
  sanitizeRegistry,
  setBundleEnabled as setBundleEnabledEntry
} from './bundleRegistry.js'

const APPROVAL_TIMEOUT_MS = 60_000
const HOST_DIR = path.dirname(fileURLToPath(import.meta.url))

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

const ARCHIVE_SUFFIX = /\.(?:tgz|tar\.gz)$/i
const BUNDLE_CONFIG = Symbol('o-hino:bundle-config')

/** 读取 npm bundle 自带的 cordis.patch.yml，把 config 合并进插件配置 */
function readBundleConfig(dir) {
  const file = path.join(dir, 'cordis.patch.yml')
  if (!fs.existsSync(file)) return {}
  try {
    const document = yaml.load(fs.readFileSync(file, 'utf-8'))
    const groups = Array.isArray(document) ? document : [document]
    for (const group of groups) {
      for (const entry of Array.isArray(group?.insert) ? group.insert : []) {
        if (entry && typeof entry.config === 'object' && !Array.isArray(entry.config)) {
          return entry.config
        }
      }
    }
  } catch (error) {
    console.warn(`[PluginHost] 忽略 ${path.basename(file)} 解析失败：${error.message}`)
  }
  return {}
}

/** 把 file:// URL / 本地绝对路径还原成磁盘路径；npm 包名返回空串 */
function specToLocalPath(spec) {
  if (/^file:/i.test(spec)) {
    // 历史注册表里可能存的是 `file:C:\...`（不是标准 file URL），
    // 直接交给 fileURLToPath 会把盘符和分隔符解析坏。
    const rawDrive = spec.slice(5).replace(/^\/+/, '')
    let drive = rawDrive
    try {
      drive = decodeURIComponent(rawDrive)
    } catch {
      // 路径中含裸 % 时保持原样
    }
    if (/^[A-Za-z]:[\\/]/.test(drive)) return path.resolve(drive)
    try {
      return fileURLToPath(spec)
    } catch {
      return ''
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/') || spec.startsWith('\\\\')) {
    return path.resolve(spec)
  }
  return ''
}

/** 把历史注册表里 `file:C:\...` 之类的非标准 URL 归一成标准 file URL */
function normalizeRegistrySpec(spec) {
  if (typeof spec !== 'string' || !/^file:/i.test(spec)) return spec
  const localPath = specToLocalPath(spec)
  return localPath ? pathToFileURL(localPath).href : spec
}

/** 拒绝 tar 包里的绝对路径与 ../ 逃逸 */
function safeArchiveEntry(name) {
  const value = String(name || '').replace(/\\/g, '/')
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  return !value.split('/').includes('..')
}

/** npm pack 生成的 tgz 通常把内容放在 package/ 下，解开后找到真正的包根目录 */
function findPackageRoot(dir) {
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir
  const children = fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory())
  if (children.length === 1 && fs.existsSync(path.join(dir, children[0].name, 'package.json'))) {
    return path.join(dir, children[0].name)
  }
  return null
}

/** 从 package.json 的 exports / module / main 里挑出可 import 的入口文件 */
function packageEntryCandidates(pkg) {
  const candidates = []
  const walkExports = (value, depth = 0) => {
    if (typeof value === 'string') {
      candidates.push(value)
    } else if (Array.isArray(value) && depth < 3) {
      value.forEach(item => walkExports(item, depth + 1))
    } else if (value && typeof value === 'object' && depth < 3) {
      for (const key of ['import', 'default', 'node', 'module', 'require']) {
        if (value[key]) walkExports(value[key], depth + 1)
      }
    }
  }
  if (pkg.exports && typeof pkg.exports === 'object' && pkg.exports['.']) {
    walkExports(pkg.exports['.'])
  } else if (pkg.exports) {
    walkExports(pkg.exports)
  }
  if (typeof pkg.module === 'string') candidates.push(pkg.module)
  if (typeof pkg.main === 'string') candidates.push(pkg.main)
  candidates.push('index.mjs', 'index.js', 'index.cjs')
  return [...new Set(candidates.filter(item => typeof item === 'string' && item && !item.startsWith('node:')))]
}

function resolvePackageEntry(dir) {
  const manifestPath = path.join(dir, 'package.json')
  // 本地目录插件允许没有 package.json，只要根目录有约定入口即可。
  if (!fs.existsSync(manifestPath)) {
    for (const name of ['index.mjs', 'index.js', 'index.cjs']) {
      const fallback = path.join(dir, name)
      if (fs.existsSync(fallback) && fs.statSync(fallback).isFile()) return fallback
    }
    throw new Error(`插件目录缺少入口文件：${dir}`)
  }
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  } catch (error) {
    throw new Error(`插件 package.json 解析失败：${error.message}`)
  }
  for (const candidate of packageEntryCandidates(pkg)) {
    let target = path.resolve(dir, candidate.replace(/^\.\//, ''))
    const isDirectory = fs.existsSync(target) && fs.statSync(target).isDirectory()
    const bases = isDirectory
      ? ['index.mjs', 'index.js', 'index.cjs'].map(name => path.join(target, name))
      : [target, `${target}.mjs`, `${target}.js`, `${target}.cjs`]
    for (const base of bases) {
      if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
    }
  }
  throw new Error(`插件包缺少可执行入口：${dir}`)
}

/**
 * 把 npm pack 产出的 .tgz / .tar.gz 解到缓存目录并按 package.json 入口加载。
 * 用源文件大小 + mtime 做指纹，替换 tgz 后下次 reload 会自动重新解包。
 */
async function extractArchive(file, cacheDir) {
  if (!fs.existsSync(file)) throw new Error(`插件包不存在：${file}`)
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error(`插件包不是文件：${file}`)
  const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`
  const root = path.join(
    cacheDir || path.join(os.tmpdir(), 'o-hino-plugin-cache'),
    createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 20)
  )
  const marker = path.join(root, '.o-hino-source.json')
  let cached = null
  try {
    cached = JSON.parse(fs.readFileSync(marker, 'utf-8'))
  } catch {
    cached = null
  }
  if (cached?.stamp === stamp && findPackageRoot(root)) {
    return {
      entry: resolvePackageEntry(findPackageRoot(root)),
      config: readBundleConfig(findPackageRoot(root)),
      stamp
    }
  }

  fs.mkdirSync(path.dirname(root), { recursive: true })
  const temp = path.join(path.dirname(root), `.tmp-${path.basename(root)}-${process.pid}-${Date.now()}`)
  fs.mkdirSync(temp, { recursive: true })
  try {
    await tar.x({ file, cwd: temp, strip: 1, filter: safeArchiveEntry })
    const packageRoot = findPackageRoot(temp)
    if (!packageRoot) throw new Error('tgz 包中缺少 package.json，无法识别为插件')
    const entry = resolvePackageEntry(packageRoot)
    fs.writeFileSync(path.join(packageRoot, '.o-hino-source.json'), JSON.stringify({
      source: path.resolve(file),
      stamp
    }, null, 2))
    const config = readBundleConfig(packageRoot)
    fs.rmSync(root, { recursive: true, force: true })
    fs.renameSync(packageRoot, root)
    return { entry: resolvePackageEntry(root), config, stamp }
  } catch (error) {
    throw new Error(`插件包解压失败：${error.message}`)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

/** CJS/ESM interop：支持 module.exports / default / 直接具名导出三种形式 */
function normalizePluginModule(loaded) {
  let candidate = loaded
  for (let depth = 0; depth < 3 && candidate && typeof candidate.apply !== 'function'; depth += 1) {
    candidate = candidate.default
  }
  if (!candidate || typeof candidate.apply !== 'function') {
    throw new Error('插件必须导出 apply(ctx, config)')
  }
  return candidate
}

function withCacheBust(fileUrl, stamp) {
  if (!stamp) return fileUrl
  return `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}o_hino_v=${encodeURIComponent(stamp)}`
}

function withBundleConfig(candidate, config) {
  if (!config || Object.keys(config).length === 0) return candidate
  // ESM 命名空间对象不可扩展，返回一个普通包装对象承载 bundle config。
  return { ...candidate, [BUNDLE_CONFIG]: config }
}

/**
 * 加载本地文件、目录、npm 包，或 npm pack 产出的 .tgz / .tar.gz。
 */
export async function loadPluginModule(spec, options = {}) {
  const resolved = resolvePluginSpec(spec)
  const localPath = specToLocalPath(resolved)
  if (localPath && ARCHIVE_SUFFIX.test(localPath)) {
    const { entry, config, stamp } = await extractArchive(localPath, options.cacheDir)
    const loaded = await import(withCacheBust(pathToFileURL(entry).href, stamp))
    return withBundleConfig(normalizePluginModule(loaded), config)
  }
  if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isDirectory()) {
    const entry = resolvePackageEntry(localPath)
    const loaded = await import(pathToFileURL(entry).href)
    return withBundleConfig(normalizePluginModule(loaded), readBundleConfig(localPath))
  }
  return normalizePluginModule(await import(resolved))
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
    register(nameOrDefinition, implementation, owner = host.currentOwner || 'system') {
      // 同时兼容本地写法 register(name, { handler }) 与 DSH 写法
      // register(defineTool({ name, execute }))。
      const definition = typeof nameOrDefinition === 'string'
        ? (implementation || {})
        : (nameOrDefinition || {})
      const name = typeof nameOrDefinition === 'string'
        ? nameOrDefinition
        : definition.name
      const resolvedOwner = typeof nameOrDefinition === 'string'
        ? owner
        : (typeof implementation === 'string' ? implementation : owner)
      if (typeof name !== 'string' || !name) throw new Error('工具名不能为空')
      const execute = typeof definition.execute === 'function'
        ? (args, _ctx, meta) => definition.execute(args, meta)
        : definition.handler
      definitions.set(name, {
        name,
        owner: resolvedOwner,
        description: definition.description || '',
        parameters: definition.parameters || null,
        handler: typeof execute === 'function' ? execute : null
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
    this.archiveCacheDir = options.archiveCacheDir || ''

    this.currentOwner = null
    this.started = false
    this.loaded = new Map()
    this.approvals = new Map()
    this.errors = new Map()
    this.effects = new Map()
    this.effectSeq = 0

    this.bus = createBus(this)
    this.agents = createAgents(this)
    this.tools = createTools(this, this.bus)
    this.context = {
      on: this.bus.on,
      emit: this.bus.emit,
      emitWaterfall: this.bus.waterfall,
      tools: this.tools,
      agents: this.agents,
      // DSH 插件常用 ctx.effect(() => cleanup) 注册卸载回调。
      effect: callback => this.effect(callback),
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
      const parsed = JSON.parse(fs.readFileSync(this.registryFile, 'utf-8'))
      const normalized = Array.isArray(parsed)
        ? parsed.map(item => {
          if (!item || typeof item.spec !== 'string') return item
          const spec = normalizeRegistrySpec(item.spec)
          const label = typeof item.label === 'string' && (item.label === item.spec || /^file:/i.test(item.label))
            ? spec
            : item.label
          return { ...item, spec, label }
        })
        : parsed
      return sanitizeRegistry(normalized)
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

  effect(callback) {
    const id = `effect-${++this.effectSeq}`
    if (typeof callback !== 'function') return () => {}
    const owner = this.currentOwner || 'system'
    let cleanup = null
    try {
      cleanup = callback()
    } catch (error) {
      this.logger?.warn?.(`[PluginHost] ${owner}/effect 初始化失败：${error.message}`)
    }
    this.effects.set(id, { owner, cleanup })
    return () => this.clearEffect(id)
  }

  clearEffect(id) {
    const record = this.effects.get(id)
    if (!record) return false
    this.effects.delete(id)
    if (typeof record.cleanup === 'function') {
      Promise.resolve(record.cleanup()).catch(error => {
        this.logger?.warn?.(`[PluginHost] ${record.owner}/effect 清理失败：${error.message}`)
      })
    }
    return true
  }

  clearEffects(owner) {
    for (const [id, record] of [...this.effects.entries()]) {
      if (record.owner === owner) this.clearEffect(id)
    }
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
      this.clearEffects(id)
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

  /**
   * DSH 官方 bundle 常用 createRequire(process.resourcesPath/app.asar/dsh/package.json)
   * 加载 dsh-tools。开发态那条规定路径解析不到应用依赖，这里在插件 apply 期间
   * 临时兜底解析到 o-hino 自身的 node_modules，避免改动第三方插件源码。
   */
  async withDshToolsRequireShim(callback) {
    const { Module } = await import('node:module')
    const original = Module?._resolveFilename
    if (typeof original !== 'function') return callback()
    const projectRequire = createRequire(path.join(HOST_DIR, '..', '..', 'package.json'))
    let fallback
    try {
      fallback = projectRequire.resolve('@deepseek-ai/dsh-tools')
    } catch {
      return callback()
    }
    const patched = function (request, ...args) {
      if (request === '@deepseek-ai/dsh-tools') {
        try {
          return original.call(this, request, ...args)
        } catch {
          return fallback
        }
      }
      return original.call(this, request, ...args)
    }
    Module._resolveFilename = patched
    try {
      return await callback()
    } finally {
      Module._resolveFilename = original
    }
  }

  async loadEntry(entry) {
    const before = new Set(this.bus.snapshot().map(item => item.id))
    this.currentOwner = entry.id
    try {
      const module = await loadPluginModule(entry.spec, { cacheDir: this.archiveCacheDir })
      if (typeof module.apply !== 'function') {
        throw new Error('插件必须导出 apply(ctx, config)')
      }
      const bundleConfig = module[BUNDLE_CONFIG] || {}
      const result = await this.withDshToolsRequireShim(() =>
        module.apply(this.context, { ...bundleConfig, ...(entry.config || {}) })
      )
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
