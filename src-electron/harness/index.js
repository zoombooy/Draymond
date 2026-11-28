import { ipcMain, session } from 'electron'
import { spawn } from 'child_process'
import { createRequire } from 'module'
import fs from 'fs'
import http from 'http'
import net from 'net'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import yaml from 'js-yaml'
import { getDataDir, loadConfig } from '../config.js'
import { normalizeOpenAIBaseUrl } from '../openaiUrl.js'
import { ensureMemoryFiles, getMemoryDir } from '../agent/memoryFiles.js'
import { clearHarnessCredentialLock } from './lockRecovery.js'
import {
  acquireLocalMcpServer,
  getLocalMcpStatus,
  releaseLocalMcpServer
} from '../agent/mcp.js'
import { listRegisteredTools } from '../agent/tools/registry.js'
import {
  MCP_SERVER_NAME as TOOL_BRIDGE_SERVER_NAME,
  buildHarnessToolManifest,
  buildApprovalPolicyConfig
} from './toolBridge.js'
import {
  sdkPrompt,
  sdkRuntimeStatus,
  sdkWait,
  startSdkRuntime,
  stopSdkRuntime
} from './sdkRuntime.js'
import {
  BundleValidationError,
  addBundle,
  normalizeBundleSpec,
  removeBundle,
  sanitizeRegistry,
  setBundleEnabled,
  toPatchEntries
} from './bundleRegistry.js'
import { PluginHost } from './pluginHost.js'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HARNESS_CONSUMER = 'deepseek-harness'
const HARNESS_PROVIDER = 'o-hino'
const HARNESS_CREDENTIAL = 'O_HINO_HARNESS_API_KEY'
const MCP_SERVER_NAME = TOOL_BRIDGE_SERVER_NAME
// 默认只运行 Draymond 自带的轻量 PluginHost。完整 DSH web / SDK 通道降级为
// 可选实验能力，只有显式设置 O_HINO_LEGACY_DSH_WEB=1 才走旧路径。
const LEGACY_DSH_ENABLED = process.env.O_HINO_LEGACY_DSH_WEB === '1'
// Generous enough for a first boot on slow hardware (e.g. ARM boards): the
// initial boot also initializes the DSH profile before the web URL is printed.
const START_TIMEOUT_MS = 90_000

let mainWindow = null
let sidecar = null
let sdkRuntime = null
let sdkStartPromise = null
let sdkMcpAcquired = false
let pluginHost = null
let startPromise = null
let generation = 0
let activeModelSignature = null
let recentOutput = []
let state = {
  status: 'idle',
  mode: 'local',
  url: null,
  port: null,
  model: null,
  toolCount: 0,
  pluginCount: 0,
  error: null
}

function publicStatus() {
  return { ...state }
}

function updateState(patch) {
  state = { ...state, ...patch }
  // Surface failures in the main-process log as well as the UI. The UI only
  // shows `error`, which can be a single terse line ("forbidden") from dsh;
  // the captured output tail is what actually explains the root cause.
  if (patch.status === 'error' && patch.error) {
    console.error(`[Harness] status=error: ${patch.error}\n[Harness] recentOutput:\n${recentOutput.map(line => `  ${line}`).join('\n')}`)
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('harness-status-changed', publicStatus())
  }
  return publicStatus()
}

function harnessPaths() {
  const root = path.join(getDataDir(), 'deepseek-harness')
  return {
    root,
    home: path.join(root, 'home'),
    workspace: path.join(root, 'workspace'),
    settings: path.join(root, 'home', 'settings.yaml'),
    credentials: path.join(root, 'home', '.credentials.yaml'),
    patch: path.join(root, 'home', 'o-hino.patch.yml'),
    bundles: path.join(root, 'bundles.json'),
    // 插件随应用一起打包，不再复制到 DSH home，避免版本漂移。
    approvalPlugin: path.resolve(__dirname, '..', '..', 'plugins', 'o-hino-tools', 'index.js'),
    knowledgePlugin: path.resolve(__dirname, '..', '..', 'plugins', 'o-hino-knowledge', 'index.js'),
    // Harness 会话摘录写入 Friday 的 /memories/ 目录，另一套 Agent 也能读到。
    memoryFile: path.join(getMemoryDir(), 'HARNESS.md')
  }
}

function ensureHarnessDirectories(paths) {
  fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 })
  fs.mkdirSync(paths.home, { recursive: true, mode: 0o700 })
  fs.mkdirSync(paths.workspace, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    fs.chmodSync(paths.root, 0o700)
    fs.chmodSync(paths.home, 0o700)
    fs.chmodSync(paths.workspace, 0o700)
  }
}

function clearStaleAppImageModuleLinks(paths) {
  const modulesRoot = path.join(paths.home, 'profiles', 'node_modules')
  if (!fs.existsSync(modulesRoot)) return

  const entries = [modulesRoot]
  while (entries.length > 0) {
    const directory = entries.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        entries.push(filename)
        continue
      }
      if (!entry.isSymbolicLink()) continue

      const target = fs.readlinkSync(filename)
      if (target.includes('/tmp/.mount_') && !fs.existsSync(filename)) {
        fs.unlinkSync(filename)
      }
    }
  }
}

function writeAtomic(filename, content, mode = 0o600) {
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${process.pid}.${Date.now()}.tmp`
  )
  fs.writeFileSync(temporary, content, { encoding: 'utf-8', mode })
  if (process.platform !== 'win32') fs.chmodSync(temporary, mode)
  fs.renameSync(temporary, filename)
  if (process.platform !== 'win32') fs.chmodSync(filename, mode)
}

// 用户自行添加的第三方 bundle 注册表。坏文件按空表处理并留备份，避免
// 一个损坏的 JSON 让整个 Harness 启动失败。
function readBundleRegistry(file) {
  if (!fs.existsSync(file)) return []
  try {
    return sanitizeRegistry(JSON.parse(fs.readFileSync(file, 'utf-8')))
  } catch (error) {
    console.warn(`[Harness] Ignoring corrupt bundle registry: ${error.message}`)
    return []
  }
}

function writeBundleRegistry(file, registry) {
  const clean = sanitizeRegistry(registry)
  writeAtomic(file, `${JSON.stringify(clean, null, 2)}\n`)
  return clean
}

// DSH 0.1.5 credentials-local only admits a versioned document whose top-level
// keys are exactly `version`, `refs` and `records` — any stray key fails the
// whole plugin tree. Store our API key under `refs:` and normalize legacy flat
// or previously-corrupted documents on the way through.
function writeHarnessCredential(filename, value) {
  const isMapping = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  const document = readYamlMapping(filename)
  const refs = isMapping(document.refs) ? { ...document.refs } : {}
  if (document.version === undefined) {
    // Pre-release flat layout: nest every entry under refs, matching DSH's own
    // in-place migration, so values survive without a hand edit.
    for (const [key, entry] of Object.entries(document)) {
      if (key === 'version' || key === 'refs' || key === 'records') continue
      refs[key] = entry
    }
  }
  // 品牌重命名前的凭证 key 不再被 DSH provider 引用；清掉旧 key 避免残留。
  delete refs.HAPPY_FRIDAY_HARNESS_API_KEY
  refs[HARNESS_CREDENTIAL] = value
  const next = { version: 1, refs }
  if (isMapping(document.records)) next.records = document.records
  writeAtomic(filename, yaml.dump(next, { noRefs: true, lineWidth: -1 }))
}

function quarantineCorruptYaml(filename, reason) {
  const backup = `${filename}.corrupt-${Date.now()}`
  try {
    fs.renameSync(filename, backup)
    console.warn(`[Harness] Ignoring corrupt ${path.basename(filename)} (${reason}); preserved as ${backup}`)
  } catch (error) {
    // If the file cannot be moved, keep the original error useful to the caller.
    throw new Error(`Unable to quarantine corrupt ${path.basename(filename)}: ${error.message}`)
  }
}

function readYamlMapping(filename) {
  if (!fs.existsSync(filename)) return {}
  const content = fs.readFileSync(filename, 'utf-8')
  let parsed
  try {
    // js-yaml rejects NUL characters before parsing. A stale/corrupt Harness
    // state file should not prevent the sidecar from recreating its config.
    if (content.includes('\u0000')) throw new Error('null byte is not allowed in input')
    parsed = yaml.load(content)
  } catch (error) {
    if (!/null byte is not allowed|YAMLException/i.test(error.message || '')) throw error
    quarantineCorruptYaml(filename, error.message)
    return {}
  }
  if (parsed === null || parsed === undefined) return {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path.basename(filename)} must contain a mapping`)
  }
  return parsed
}

function selectedModel() {
  const config = loadConfig()
  const models = Array.isArray(config.customModels) ? config.customModels : []
  const model = models.find(item => item.id === config.selectedModelId)
  if (!model || !model.apiKey || !model.modelName || !model.baseUrl) {
    const error = new Error('请先在设置中配置并选择一个可用模型')
    error.code = 'HARNESS_MODEL_REQUIRED'
    throw error
  }
  // DSH appends /chat/completions for the openai-completions API. Normalize
  // both provider base URLs and custom full endpoints before writing settings.
  const baseUrl = normalizeOpenAIBaseUrl(model.baseUrl)
  return {
    provider: String(model.provider || 'other'),
    providerLabel: model.providerLabel || model.provider || 'Custom',
    apiKey: String(model.apiKey),
    modelName: String(model.modelName),
    baseUrl
  }
}

function modelSignature(model) {
  return JSON.stringify([model.provider, model.providerLabel, model.apiKey, model.modelName, model.baseUrl])
}

function themePreference() {
  const theme = loadConfig().theme
  return ['light', 'dark', 'system'].includes(theme) ? theme : 'system'
}

function localePreference() {
  return loadConfig().language === 'en-US' ? 'en' : 'zh'
}

function harnessSignature(model, theme, locale) {
  return JSON.stringify([modelSignature(model), theme, locale])
}

function mcpToolConfiguration() {
  const manifest = buildHarnessToolManifest(listRegisteredTools(), { serverName: MCP_SERVER_NAME })
  return {
    ...manifest,
    approvalConfig: buildApprovalPolicyConfig(manifest)
  }
}

function selectedModelOrNull() {
  try {
    return selectedModel()
  } catch (_error) {
    return null
  }
}

// 本地 PluginHost 的知识检索工具：直接复用 RAG 检索，不再经过 DSH 的 MCP 桥接。
async function retrieveKnowledgeForLocalTool(args = {}) {
  const query = typeof args.query === 'string' ? args.query : ''
  if (!query.trim()) return '知识库检索失败：query 不能为空'
  const topK = Number.isFinite(args.topK) && args.topK > 0 ? args.topK : 3
  try {
    const { searchKnowledgeBase } = await import('../rag/index.js')
    const results = await searchKnowledgeBase(query, '', '', topK, 0.5, '')
    if (!results || results.length === 0) return '未在知识库中检索到相关内容。'
    return results.map((item, index) => {
      const source = item.source ? `\n[来源: ${item.source}]` : ''
      const confidence = `\n[置信度: ${(Number(item.confidence || 0) * 100).toFixed(1)}%]`
      return `【知识片段 ${index + 1}】${confidence}${source}\n${item.content}`
    }).join('\n\n')
  } catch (error) {
    return `知识库检索失败: ${error.message}`
  }
}

function ensurePluginHost() {
  if (pluginHost) return pluginHost
  const paths = harnessPaths()
  ensureHarnessDirectories(paths)
  const { approvalConfig } = mcpToolConfiguration()
  const model = selectedModelOrNull()

  pluginHost = new PluginHost({
    registryFile: paths.bundles,
    builtins: [
      {
        id: 'builtin-o-hino-tools',
        label: 'o-hino 工具审批',
        spec: pathToFileURL(paths.approvalPlugin).href,
        config: approvalConfig
      },
      {
        id: 'builtin-o-hino-knowledge',
        label: 'o-hino 知识注入',
        spec: pathToFileURL(paths.knowledgePlugin).href,
        config: {
          toolName: `mcp__${MCP_SERVER_NAME}__retrieve_knowledge`,
          topK: 3,
          maxChars: 4000,
          maxSnippetChars: 3000,
          preStepTimeoutMs: 1500,
          maxEntries: 40,
          captureUser: false,
          memoryFile: paths.memoryFile
        }
      }
    ],
    tools: [{
      name: `mcp__${MCP_SERVER_NAME}__retrieve_knowledge`,
      description: '从 o-hino 本地知识库检索相关内容',
      handler: retrieveKnowledgeForLocalTool
    }],
    onEvent: (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload)
      }
    }
  })
  return pluginHost
}

function localHostStatus() {
  if (!pluginHost) return { ...state }
  const plugins = pluginHost.list()
  return {
    ...state,
    toolCount: pluginHost.listTools().length,
    pluginCount: plugins.filter(item => item.loaded).length
  }
}

async function startLocalPluginHost() {
  const host = ensurePluginHost()
  updateState({ status: 'starting', mode: 'local', error: null })
  await host.start()
  const model = selectedModelOrNull()
  console.log(`[PluginHost] local host ready: ${host.list().filter(item => item.loaded).length} plugins, ${host.listTools().length} tools`)
  return updateState({
    status: 'ready',
    mode: 'local',
    url: null,
    port: null,
    model: model
      ? { providerLabel: model.providerLabel, modelName: model.modelName }
      : null,
    error: null,
    ...localHostStatus()
  })
}

function syncConfiguration(model, mcpUrl) {
  const paths = harnessPaths()
  ensureHarnessDirectories(paths)
  // 确保 /memories/HARNESS.md 存在，插件只需覆盖标记之间的段落
  ensureMemoryFiles()
  const theme = themePreference()
  const locale = localePreference()

  const settings = readYamlMapping(paths.settings)
  settings['ui-theme'] = { preference: theme }
  settings.locale = { preference: locale }
  settings['agent-default-model'] = {
    provider: HARNESS_PROVIDER,
    model: model.modelName
  }
  settings['llm-pi-ai'] = {
    providers: {
      [HARNESS_PROVIDER]: {
        displayName: model.providerLabel,
        apiKeyEnv: HARNESS_CREDENTIAL,
        api: 'openai-completions',
        baseURL: model.baseUrl,
        models: [{ id: model.modelName, name: model.modelName }]
      }
    }
  }
  writeAtomic(paths.settings, yaml.dump(settings, { noRefs: true, lineWidth: 120 }))

  writeHarnessCredential(paths.credentials, model.apiKey)

  const { toolCount, approvalConfig } = mcpToolConfiguration()
  const patch = [
    { id: 'llm-deepseek', disabled: true },
    { id: 'ui-settings-models', disabled: true },
    // DSH's adaptive picker selects its native Win32 implementation in a
    // loopback session. That implementation launches a second Electron
    // process as a Node worker, which exits before it can reply in packaged
    // builds. The browse backend is DSH's supported alternative: it runs in
    // the already-connected Harness page and uses regular filesystem APIs.
    ...(process.platform === 'win32'
      ? [
          {
            id: 'directory-picker',
            disabled: true
          },
          {
            insert: [
              {
                id: 'o-hino-directory-picker',
                name: '@deepseek-ai/dsh-host-directory-picker-browse'
              },
              {
                id: 'o-hino-directory-picker-ui',
                name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
              }
            ]
          }
        ]
      : []),
    {
      insert: [
        {
          id: 'mcp-o-hino',
          name: '@deepseek-ai/dsh-mcp-client',
          config: {
            serverName: MCP_SERVER_NAME,
            transport: 'streamable-http',
            url: mcpUrl,
            toolCallTimeoutMs: 300000,
            failOnStartupError: true
          }
        },
        {
          id: 'o-hino-tool-approval',
          name: pathToFileURL(paths.approvalPlugin).href,
          inject: ['tools'],
          config: approvalConfig
        },
        {
          id: 'o-hino-knowledge',
          name: pathToFileURL(paths.knowledgePlugin).href,
          inject: ['agents', 'tools'],
          config: {
            toolName: `mcp__${MCP_SERVER_NAME}__retrieve_knowledge`,
            topK: 3,
            maxChars: 4000,
            maxSnippetChars: 3000,
            preStepTimeoutMs: 1500,
            maxEntries: 40,
            // 默认不把用户原话写进长期记忆，避免隐私内容落盘
            captureUser: false,
            memoryFile: paths.memoryFile
          }
        },
        // 用户添加的第三方 bundle / 插件，与内置插件同一份 patch，
        // web 与 sdk 两条通道都会加载。禁用项以 disabled 条目保留。
        ...toPatchEntries(readBundleRegistry(paths.bundles))
      ]
    }
  ]
  writeAtomic(paths.patch, yaml.dump(patch, { noRefs: true, lineWidth: 120 }))

  return { paths, toolCount }
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function resolveHarnessCli() {
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  const cli = path.join(path.dirname(manifest), 'lib', 'bin.js')
  const unpacked = cli.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
  return fs.existsSync(unpacked) ? unpacked : cli
}

// Probe the bare origin, never the token URL. DSH answers 401 on the bare
// origin until the per-process token is exchanged, so any HTTP response means
// the server is up. Following the token URL here would consume the exchange
// outside Electron's webRequest pipeline: the 303 would not be seen by
// onHeadersReceived, leaving the iframe without the session cookie.
function probe(url) {
  return new Promise(resolve => {
    let origin
    try {
      origin = new URL(url).origin
    } catch {
      resolve(false)
      return
    }
    const request = http.get(origin, response => {
      response.resume()
      resolve(true)
    })
    request.setTimeout(1000, () => request.destroy())
    request.on('error', () => resolve(false))
  })
}

function harnessLaunchUrl() {
  for (const line of recentOutput) {
    if (line.startsWith('dsh web: http')) {
      const match = line.match(/^dsh web: (https?:\/\/\S+)/)
      if (match) return match[1]
    }
  }
  return null
}

// DSH 0.1.5 exchanges the printed `?token=` URL for a `SameSite=Strict` session
// cookie. The harness page runs inside a cross-site iframe (the app window is
// http://localhost in dev and file:// when packaged), so Chromium's
// site-for-cookies rule never attaches that cookie to the iframe's requests and
// every navigation after the token exchange answers 401. Forward the cookie at
// the network layer instead: capture the Set-Cookie the harness issues and
// replay it as an explicit Cookie header on every request to the harness origin.
//
// DSH 0.2 adds a second fence in `isTrustedApiRequest` (dsh-client-connection):
// a request is rejected with a bare `403 forbidden` when `sec-fetch-site` is
// `cross-site` or the `Origin` is not this listener's own authority. Both hold
// for an iframe hosted at localhost:5173 talking to 127.0.0.1:<port>. Rewrite
// those browser-supplied headers at the network layer so the iframe is seen as
// same-origin; the cookie forward below then completes the authentication.
const DSH_COOKIE_PREFIX = 'dsh-auth-'

function enableHarnessCookieForwarding(port) {
  if (!LEGACY_DSH_ENABLED) return
  const filter = { urls: [`http://127.0.0.1:${port}/*`, `ws://127.0.0.1:${port}/*`] }
  const webRequest = session.defaultSession.webRequest
  const ownOrigin = `http://127.0.0.1:${port}`
  let cookie = null
  let loggedCapture = false
  let loggedForward = false
  let loggedOrigin = false
  webRequest.onHeadersReceived(filter, (details, callback) => {
    for (const key of Object.keys(details.responseHeaders ?? {})) {
      if (key.toLowerCase() !== 'set-cookie') continue
      for (const line of details.responseHeaders[key] ?? []) {
        const pair = line.split(';', 1)[0]
        if (!pair.startsWith(DSH_COOKIE_PREFIX)) continue
        cookie = pair
        if (!loggedCapture) {
          loggedCapture = true
          console.log('[Harness] Captured dsh auth cookie from webRequest')
        }
      }
    }
    callback({})
  })
  webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = details.requestHeaders
    // Chromium lowercases request header names. Setting `Cookie` (capitalized)
    // adds a second header beside the empty one Chromium already prepared, so
    // dsh still sees no usable credential and answers 401 ("Connect to this
    // Host"). Strip every casing variant and write the lowercase form only.
    if (cookie) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'cookie') delete headers[key]
      }
      headers.cookie = cookie
      if (!loggedForward) {
        loggedForward = true
        console.log('[Harness] Forwarding dsh auth cookie to iframe requests')
      }
    }
    // DSH 0.2 source fence: drop the cross-site marker and present the
    // listener's own Origin so isTrustedApiRequest() admits the request.
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (lower === 'sec-fetch-site') headers[key] = 'same-origin'
      if (lower === 'origin') headers[key] = ownOrigin
      if (lower === 'referer') headers[key] = `${ownOrigin}/`
    }
    if (!headers['sec-fetch-site']) headers['sec-fetch-site'] = 'same-origin'
    if (!headers.origin) headers.origin = ownOrigin
    if (!loggedOrigin) {
      loggedOrigin = true
      console.log('[Harness] Rewriting iframe origin headers to dsh same-origin')
    }
    callback({ requestHeaders: headers })
  })
}

// When only the fallback is available (timeout, or a silent exit with no
// recognizable error line), append the captured output so slow/failed boots on
// machines we cannot inspect directly stay diagnosable from the UI alone.
function outputTail(limit = 10) {
  const lines = recentOutput.slice(-limit)
  if (lines.length === 0) return ''
  return `\n\nLast DSH output:\n${lines.map(line => `  ${line}`).join('\n')}`
}

// DSH fatal boot errors are multi-line: the `Error: dsh: ...` headline is
// followed by the concrete per-entry failures (e.g. the individual reasons
// inside a "loader entries failed to apply" AggregateError). Keep enough
// history and surface the whole block from the first diagnostic line, so a
// failing plugin and its real cause are visible in the UI alone.
const DETAIL_MAX_LINES = 25

function isDiagnosticLine(line) {
  return line.includes('Error: dsh:')
    || /^error(?:\s+\[[^\]]+\])?:/i.test(line)
    || /cannot find package/i.test(line)
}

function failureDetail(fallback) {
  const index = recentOutput.findIndex(isDiagnosticLine)
  if (index !== -1) {
    return recentOutput.slice(index, index + DETAIL_MAX_LINES).join('\n')
  }
  // No recognizable error line (timeout, or a silent exit). The output tail
  // includes the last meaningful line.
  return fallback + outputTail()
}

async function waitUntilReady(child, expectedGeneration) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (expectedGeneration !== generation) {
      throw new Error('Harness startup was superseded')
    }
    if (child.exitCode !== null) {
      // `exit` can be emitted before stderr has flushed. Give its diagnostic
      // output a brief chance to reach `captureOutput` before selecting it.
      await new Promise(resolve => setTimeout(resolve, 50))
      throw new Error(failureDetail(`Harness exited with code ${child.exitCode}`))
    }
    if (child.harnessSpawnError) throw child.harnessSpawnError
    if (child !== sidecar) throw new Error(failureDetail('Harness stopped before becoming ready'))
    // DSH 0.1.5 authenticates the web profile with a per-process launch token:
    // the bare origin answers 401 until the iframe loads the printed `?token=`
    // URL. Wait for that URL to be announced and answerable before reporting ready.
    const authenticatedUrl = harnessLaunchUrl()
    if (authenticatedUrl && await probe(authenticatedUrl)) return authenticatedUrl
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(failureDetail(`Harness startup timed out after ${Math.round(START_TIMEOUT_MS / 1000)}s`))
}

function captureOutput(stream) {
  stream.setEncoding('utf-8')
  stream.on('data', chunk => {
    for (const line of chunk.split(/\r?\n/)) {
      const value = line.trim()
      if (!value) continue
      recentOutput.push(value)
      if (recentOutput.length > 100) recentOutput.shift()
    }
  })
}

async function bootHarness() {
  const expectedGeneration = ++generation
  updateState({ status: 'starting', error: null, url: null, port: null, model: null, toolCount: 0 })

  let model
  try {
    model = selectedModel()
  } catch (error) {
    updateState({ status: 'config-required', model: null, error: error.message })
    return publicStatus()
  }

  let acquiredMcp = false
  let launchedChild = null
  try {
    const mcp = await acquireLocalMcpServer(HARNESS_CONSUMER)
    acquiredMcp = true
    const mcpStatus = getLocalMcpStatus()
    if (!mcp.success || !mcpStatus.url) throw new Error('o-hino MCP server failed to start')
    if (expectedGeneration !== generation) throw new Error('Harness startup was superseded')

    const { paths, toolCount } = syncConfiguration(model, mcpStatus.url)
    clearStaleAppImageModuleLinks(paths)
    const port = await findOpenPort()
    if (expectedGeneration !== generation) throw new Error('Harness startup was superseded')
    const cli = resolveHarnessCli()
    recentOutput = []
    if (clearHarnessCredentialLock(paths.credentials)) {
      console.warn(`[Harness] Removed stale writer lock at ${paths.credentials}.lock`)
    }

    const child = spawn(
      process.execPath,
      ['--expose-internals', cli, 'web', '--patch', paths.patch, '--host', '127.0.0.1', '--port', String(port), '--no-open'],
      {
        cwd: paths.workspace,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          DSH_HOME: paths.home,
          DSH_CWD: paths.workspace,
          DSH_PERMISSION_MODE: 'workspace-write',
          DSH_TELEMETRY_DISABLED: '1',
          DSH_TOOLS_MODE: 'native'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    )
    launchedChild = child
    sidecar = child
    captureOutput(child.stdout)
    captureOutput(child.stderr)
    enableHarnessCookieForwarding(port)
    child.once('error', error => {
      child.harnessSpawnError = error
      recentOutput.push(error.message)
    })

    child.once('exit', (code, signal) => {
      if (child !== sidecar || expectedGeneration !== generation) return
      sidecar = null
      activeModelSignature = null
      releaseLocalMcpServer(HARNESS_CONSUMER).catch(() => {})
      const intentional = state.status === 'stopping' || state.status === 'idle'
      updateState(intentional
        ? { status: 'idle', url: null, port: null, model: null, toolCount: 0, error: null }
        : {
            status: 'error',
            url: null,
            port: null,
            model: null,
            toolCount: 0,
            error: failureDetail(`Harness exited (${signal || code || 'unknown'})`)
          })
    })

    const authenticatedUrl = await waitUntilReady(child, expectedGeneration)
    activeModelSignature = harnessSignature(model, themePreference(), localePreference())
    return updateState({
      status: 'ready',
      url: authenticatedUrl,
      port,
      model: { providerLabel: model.providerLabel, modelName: model.modelName },
      toolCount,
      error: null
    })
  } catch (error) {
    if (launchedChild && launchedChild.exitCode === null) launchedChild.kill('SIGTERM')
    if (acquiredMcp) await releaseLocalMcpServer(HARNESS_CONSUMER).catch(() => {})
    if (expectedGeneration === generation) {
      activeModelSignature = null
      if (sidecar === launchedChild) sidecar = null
      updateState({
        status: error.code === 'HARNESS_MODEL_REQUIRED' ? 'config-required' : 'error',
        url: null,
        port: null,
        model: null,
        toolCount: 0,
        error: error.message || String(error)
      })
      console.error(`[Harness] Startup failed: ${error.message || String(error)}`)
    }
    return publicStatus()
  }
}

export function startHarnessSidecar() {
  if (!LEGACY_DSH_ENABLED) {
    if (pluginHost && state.status === 'ready') return Promise.resolve(localHostStatus())
    if (startPromise) return startPromise
    startPromise = startLocalPluginHost().finally(() => {
      startPromise = null
    })
    return startPromise
  }

  if (sidecar && state.status === 'ready') return Promise.resolve(publicStatus())
  if (startPromise) return startPromise
  startPromise = bootHarness().finally(() => {
    startPromise = null
  })
  return startPromise
}

/** 显式启动完整 DSH web 通道，仅供兼容验证使用。 */
export function startLegacyHarnessSidecar() {
  if (sidecar && state.status === 'ready') return Promise.resolve(publicStatus())
  if (startPromise) return startPromise
  startPromise = bootHarness().finally(() => {
    startPromise = null
  })
  return startPromise
}

export async function stopHarnessSidecar() {
  generation += 1
  const child = sidecar
  sidecar = null
  startPromise = null
  activeModelSignature = null
  updateState({
    status: child ? 'stopping' : 'idle',
    mode: 'local',
    url: null,
    port: null,
    model: null,
    toolCount: 0,
    pluginCount: 0,
    error: null
  })
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
        resolve()
      }, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  await releaseLocalMcpServer(HARNESS_CONSUMER)
  if (pluginHost) {
    await pluginHost.stop()
    pluginHost = null
  }
  return updateState({
    status: 'idle',
    mode: 'local',
    url: null,
    port: null,
    model: null,
    toolCount: 0,
    pluginCount: 0,
    error: null
  })
}

export async function restartHarnessSidecar() {
  await stopHarnessSidecar()
  return startHarnessSidecar()
}

export async function syncHarnessConfigurationIfRunning() {
  if (!LEGACY_DSH_ENABLED) return localHostStatus()
  if (!sidecar || state.status !== 'ready') return publicStatus()
  try {
    const model = selectedModel()
    if (harnessSignature(model, themePreference(), localePreference()) === activeModelSignature) return publicStatus()
    return restartHarnessSidecar()
  } catch (error) {
    await stopHarnessSidecar()
    return updateState({
      status: error.code === 'HARNESS_MODEL_REQUIRED' ? 'config-required' : 'error',
      error: error.message,
      model: null,
      toolCount: 0
    })
  }
}

// ========== P3 SDK 实验通道 ==========
// 与 web sidecar 并行，默认不启用。只有渲染进程显式调用 harness-sdk-start
// 才会拉起 `dsh --profile sdk` 子进程；两条通道共用同一份 DSH home/settings，
// 因此 P1 工具审批与 P2 知识注入插件无需改动即可复用。

function sdkEventToRenderer(entry) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('harness-sdk-event', entry)
  }
}

async function startSdkChannel() {
  if (sdkRuntime && sdkRuntime.status === 'ready') return sdkRuntimeStatus(sdkRuntime)
  if (sdkStartPromise) return sdkStartPromise

  sdkStartPromise = (async () => {
    let model
    try {
      model = selectedModel()
    } catch (error) {
      return { status: error.code === 'HARNESS_MODEL_REQUIRED' ? 'config-required' : 'error', error: error.message }
    }

    try {
      const mcp = await acquireLocalMcpServer(HARNESS_CONSUMER)
      sdkMcpAcquired = true
      const mcpStatus = getLocalMcpStatus()
      if (!mcp.success || !mcpStatus.url) throw new Error('o-hino MCP server failed to start')

      syncConfiguration(model, mcpStatus.url)
      const paths = harnessPaths()
      clearHarnessCredentialLock(paths.credentials)

      sdkRuntime = await startSdkRuntime({
        cli: resolveHarnessCli(),
        paths,
        model,
        onEvent: sdkEventToRenderer,
        onOutput: line => console.log(`[Harness SDK] ${line}`)
      })
      return sdkRuntimeStatus(sdkRuntime)
    } catch (error) {
      if (sdkMcpAcquired) {
        await releaseLocalMcpServer(HARNESS_CONSUMER).catch(() => {})
        sdkMcpAcquired = false
      }
      sdkRuntime = null
      const status = { status: 'error', error: error.message || String(error) }
      sdkEventToRenderer({ role: 'system', text: status.error })
      return status
    } finally {
      sdkStartPromise = null
    }
  })()

  return sdkStartPromise
}

async function stopSdkChannel() {
  const runtime = sdkRuntime
  sdkRuntime = null
  await stopSdkRuntime(runtime)
  if (sdkMcpAcquired) {
    await releaseLocalMcpServer(HARNESS_CONSUMER).catch(() => {})
    sdkMcpAcquired = false
  }
  return sdkRuntimeStatus(null)
}

export function registerHarnessCommands(window) {
  mainWindow = window
  ipcMain.handle('harness-start', () => startHarnessSidecar())
  ipcMain.handle('harness-status', () => publicStatus())
  ipcMain.handle('harness-restart', () => restartHarnessSidecar())
  ipcMain.handle('harness-sync-config', () => syncHarnessConfigurationIfRunning())
  ipcMain.handle('harness-sdk-start', () => startSdkChannel())
  ipcMain.handle('harness-sdk-status', () => sdkRuntimeStatus(sdkRuntime))
  ipcMain.handle('harness-sdk-prompt', (_event, text, options) => sdkPrompt(sdkRuntime, text, options || {}))
  ipcMain.handle('harness-sdk-wait', (_event, options) => sdkWait(sdkRuntime, options || {}))
  ipcMain.handle('harness-sdk-stop', () => stopSdkChannel())

  // ===== 本地 PluginHost：默认插件机制，不加载 DSH 运行时 =====
  const pluginSnapshot = async () => {
    const host = ensurePluginHost()
    await host.start()
    return {
      status: localHostStatus(),
      plugins: host.list(),
      tools: host.listTools(),
      approvals: host.pendingApprovals()
    }
  }
  ipcMain.handle('harness-plugins-list', () => pluginSnapshot())
  ipcMain.handle('harness-plugins-reload', async () => {
    const host = ensurePluginHost()
    await host.reload()
    return pluginSnapshot()
  })
  ipcMain.handle('harness-plugins-add', async (_event, input) => {
    const host = ensurePluginHost()
    try {
      const result = await host.addBundle(input)
      return { ...result, ok: true }
    } catch (error) {
      return { ok: false, error: error.message || String(error) }
    }
  })
  ipcMain.handle('harness-plugins-remove', async (_event, id) => {
    const host = ensurePluginHost()
    await host.removeBundle(id)
    return pluginSnapshot()
  })
  ipcMain.handle('harness-plugins-toggle', async (_event, id, enabled) => {
    const host = ensurePluginHost()
    try {
      await host.toggleBundle(id, enabled)
      return { ok: true, ...(await pluginSnapshot()) }
    } catch (error) {
      return { ok: false, error: error.message || String(error) }
    }
  })
  ipcMain.handle('harness-plugins-invoke', async (_event, name, args) => {
    const host = ensurePluginHost()
    await host.start()
    return host.invokeTool(name, args || {})
  })
  ipcMain.handle('harness-plugins-approve', (_event, id, approved) => {
    const host = ensurePluginHost()
    return { ok: host.approve(id, approved !== false) }
  })

  // 第三方 bundle 管理。变更只写注册表；patch 在下次启动时由 syncConfiguration
  // 重新生成，所以运行中的 Harness 需要重启才能加载，UI 据此提示用户。
  ipcMain.handle('harness-bundles-list', () => {
    const paths = harnessPaths()
    return {
      bundles: readBundleRegistry(paths.bundles),
      restartRequired: LEGACY_DSH_ENABLED && (state.status === 'ready' || !!sdkRuntime)
    }
  })
  const bundleResult = result => ({
    ...result,
    bundles: result.registry,
    restartRequired: LEGACY_DSH_ENABLED && (state.status === 'ready' || !!sdkRuntime)
  })
  ipcMain.handle('harness-bundles-add', (_event, input) => {
    const file = harnessPaths().bundles
    let spec
    try {
      spec = normalizeBundleSpec(typeof input === 'string' ? input : input?.spec)
    } catch (error) {
      if (error instanceof BundleValidationError) throw error
      throw new Error(`无法解析插件位置：${error.message}`)
    }
    const label = typeof input === 'object' && typeof input.label === 'string' ? input.label : ''
    const result = addBundle(readBundleRegistry(file), spec, { label })
    return bundleResult({ ...result, registry: writeBundleRegistry(file, result.registry) })
  })
  ipcMain.handle('harness-bundles-remove', (_event, id) => {
    const file = harnessPaths().bundles
    const result = removeBundle(readBundleRegistry(file), id)
    return bundleResult({ ...result, registry: writeBundleRegistry(file, result.registry) })
  })
  ipcMain.handle('harness-bundles-toggle', (_event, id, enabled) => {
    const file = harnessPaths().bundles
    const result = setBundleEnabled(readBundleRegistry(file), id, !!enabled)
    return bundleResult({ ...result, registry: writeBundleRegistry(file, result.registry) })
  })
}
