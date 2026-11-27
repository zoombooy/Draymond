/**
 * o-hino 知识库注入 / 记忆投影插件
 * ======================================
 *
 * 挂载在 DSH 0.2.x 运行时内，做两件事：
 *   1. 用户输入进入 session/event 时，经本机 MCP 调用 retrieve_knowledge，
 *      用 agent.inject() 把结果排进下一次 pre-step；同时在 agent/pre-step
 *      里把已完成的检索结果并入当前批次，避免首轮对话晚一拍。
 *   2. 将 assistant/message 等持久事件投影到 /memories/HARNESS.md，
 *      让 Friday 的另一套 Agent 也能读到 Harness 会话中的重要结论。
 *
 * 纯逻辑在 src-electron/harness/knowledgeBridge.js，本文件只负责插件生命周期与 IO。
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import {
  INJECTION_SOURCE_KIND,
  DEFAULT_HARNESS_MEMORY,
  buildInjectionText,
  extractToolResultText,
  isUserInputEvent,
  memoryEntryFromEvent,
  queryFromEvent,
  upsertMemorySection
} from '../../src-electron/harness/knowledgeBridge.js'

export const name = 'o-hino-knowledge'
export const inject = ['agents', 'tools']

let createUserMessageFactory

/** 尽量使用 DSH 官方构造器，保证 id / source 等不变量；缺失时退化为普通对象 */
async function buildInjectedMessage(text, sourceKind) {
  if (createUserMessageFactory === undefined) {
    try {
      const llmMessage = await import('@deepseek-ai/dsh-llm/message')
      createUserMessageFactory = typeof llmMessage.createUserMessage === 'function'
        ? llmMessage.createUserMessage
        : null
    } catch (_error) {
      createUserMessageFactory = null
    }
  }

  const content = [{ type: 'text', text }]
  const source = { kind: sourceKind }
  if (createUserMessageFactory) return createUserMessageFactory({ content, source })
  return { id: randomUUID(), role: 'user', content, source }
}

function normalizeConfig(config) {
  const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback
  return {
    toolName: typeof config.toolName === 'string' && config.toolName
      ? config.toolName
      : 'mcp__o-hino__retrieve_knowledge',
    topK: positive(config.topK, 3),
    maxChars: positive(config.maxChars, 4000),
    maxSnippetChars: positive(config.maxSnippetChars, 3000),
    preStepTimeoutMs: positive(config.preStepTimeoutMs, 1500),
    maxEntries: positive(config.maxEntries, 40),
    maxQueryChars: positive(config.maxQueryChars, 2000),
    maxEntryChars: positive(config.maxEntryChars, 280),
    captureUser: config.captureUser === true,
    memoryFile: typeof config.memoryFile === 'string' ? config.memoryFile : ''
  }
}

/** 经 ctx.tools.execute 调用已挂载的本机 MCP 检索工具 */
async function retrieveKnowledge(ctx, agent, query, config) {
  const definition = ctx.tools?.get?.(config.toolName, agent?.ctx)
  if (!definition) return ''

  const result = await ctx.tools.execute({
    calls: [{
      type: 'tool-call',
      id: `hf-kb-${randomUUID()}`,
      name: config.toolName,
      arguments: JSON.stringify({ query, topK: config.topK })
    }],
    signal: new AbortController().signal,
    agent
  })

  return extractToolResultText(result)
}

function withTimeout(promise, timeoutMs) {
  let timer
  const guard = new Promise(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

/** 幂等写入 HARNESS.md：只覆盖标记之间的段落 */
function projectMemory(config, sessionId, event) {
  if (!config.memoryFile) return false

  const entry = memoryEntryFromEvent(event, sessionId, {
    captureUser: config.captureUser,
    maxChars: config.maxEntryChars
  })
  if (!entry) return false

  const target = config.memoryFile
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : DEFAULT_HARNESS_MEMORY
  const next = upsertMemorySection(existing, [entry], { maxEntries: config.maxEntries })
  if (next === existing) return false

  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, next, 'utf-8')
  fs.renameSync(temporary, target)
  return true
}

export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config)
  const sourceKind = INJECTION_SOURCE_KIND
  const pending = new Map()
  const processed = new Set()

  ctx.on('session/event', (session, event) => {
    try {
      projectMemory(cfg, session?.id, event)
    } catch (error) {
      ctx.logger?.warn?.(`[HarnessMemory] 投影失败: ${error.message}`)
    }

    if (!isUserInputEvent(event)) return

    const sessionId = session?.id
    const agent = ctx.agents?.get?.(sessionId)
    if (!agent) return

    const key = `${sessionId}:${event.seq}`
    if (processed.has(key)) return
    processed.add(key)
    if (processed.size > 1000) processed.clear()

    const query = queryFromEvent(event, { maxChars: cfg.maxQueryChars })
    if (!query.trim()) return

    const task = (async () => {
      const raw = await retrieveKnowledge(ctx, agent, query, cfg)
      const text = buildInjectionText(query, raw, cfg)
      if (!text) return null
      return buildInjectedMessage(text, sourceKind)
    })()

    const item = { sessionId, seq: event.seq, promise: task, claimed: false }
    pending.set(sessionId, item)

    task.then(message => {
      if (pending.get(sessionId) !== item || item.claimed) return
      // pre-step 没有消费到（例如检索完成得太晚）：交给 agent.inject()，
      // 落到下一次被接纳的请求，不唤醒 driver。
      if (message && typeof agent.inject === 'function') {
        agent.inject(message)
      }
      pending.delete(sessionId)
    }).catch(error => {
      ctx.logger?.warn?.(`[HarnessKnowledge] 检索失败: ${error.message}`)
      if (pending.get(sessionId) === item) pending.delete(sessionId)
    })
  })

  // waterfall：必须调用 next() 才能让默认的 runtime-context 投影继续执行。
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = ctx.agents?.currentInitiator?.()
    const sessionId = agent?.id
    const item = sessionId ? pending.get(sessionId) : null
    // 同步占位：检索 promise 可能在 await next() 期间就结算，
    // 先 claimed 才能让 .then 放弃 agent.inject()，避免同轮重复注入。
    if (item) item.claimed = true

    let decision
    try {
      decision = await next()
    } catch (error) {
      if (pending.get(sessionId) === item) pending.delete(sessionId)
      throw error
    }
    if (!item || decision?.kind !== 'enter' || !Array.isArray(decision.messages)) {
      if (item && pending.get(sessionId) === item) pending.delete(sessionId)
      return decision
    }

    let message = null
    try {
      message = await withTimeout(item.promise, cfg.preStepTimeoutMs)
    } catch (error) {
      ctx.logger?.warn?.(`[HarnessKnowledge] pre-step 注入失败: ${error.message}`)
    }
    if (pending.get(sessionId) === item) pending.delete(sessionId)
    if (!message) return decision

    return { ...decision, messages: [...decision.messages, message] }
  })
}
