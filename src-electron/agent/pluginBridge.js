/**
 * 插件桥接层：把本地 PluginHost 的插件能力接入日常对话 Agent
 * ============================================================
 *
 * 现状：插件宿主（src-electron/harness/pluginHost.js）与日常对话 Agent
 * （src-electron/agent/）原本是两条独立链路。本模块负责把它们接通：
 *
 *   1. 工具桥：把 PluginHost 里注册的工具（含第三方 tgz bundle 的工具）
 *      镜像注册进 agent/tools/registry.js，让 LLM 在对话里能选择调用。
 *      复用 registry 的包装链，因此自动获得日志、审计落库、agent-tool-*
 *      IPC 通知和 interruptOn 审批能力。
 *   2. 事件桥：在每轮 agent-invoke 中触发 session/event（让知识注入插件
 *      开始检索）与 agent/pre-step waterfall（把检索结果并入本轮输入）。
 *
 * 设计约束：
 *   - 只桥接第三方/外部插件工具，跳过宿主内置的知识检索工具
 *     （mcp__o-hino__*，日常对话已有自己的 retrieve_knowledge）。
 *   - 桥接工具带 plugin__ 前缀，避免与内置工具同名冲突；对未知的第三方
 *     工具一律要求审批（保守策略），因为插件代码不在本项目可信边界内。
 *   - 每轮同步会清理上一轮注册的桥接工具，保证插件启停即时生效。
 *   - 任何失败都不应阻断日常对话：桥接内部 try/catch，失败时降级为无插件。
 */

import { z } from 'zod'
import { registerTool, listToolNames } from './tools/registry.js'
import { createLogger } from './logger.js'

const log = createLogger('PluginBridge')

const BRIDGE_PREFIX = 'plugin__'
const INTERNAL_TOOL_PREFIX = 'mcp__o-hino__'

/** 已由本模块注册的工具名，用于增量清理（name -> signature） */
let bridgedTools = new Map()

/** 延迟获取宿主实例，避免模块加载期就初始化 harness（含 Electron 依赖） */
async function getHost() {
  const mod = await import('../harness/index.js')
  if (typeof mod.getSharedPluginHost !== 'function') return null
  return mod.getSharedPluginHost()
}

/**
 * 把 JSON Schema（defineTool 的 parameters）转换为 registerTool 需要的 zod 对象。
 * 只处理常见类型；无法识别的字段退化为 z.any()，保证不阻断注册。
 */
function jsonSchemaToZod(schema) {
  if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
    return z.object({}).passthrough()
  }
  const shape = {}
  const properties = schema.properties || {}
  const required = Array.isArray(schema.required) ? schema.required : []

  for (const [key, raw] of Object.entries(properties)) {
    let field = jsonSchemaFieldToZod(raw)
    if (!required.includes(key)) field = field.optional()
    shape[key] = field
  }
  return z.object(shape).passthrough()
}

function jsonSchemaFieldToZod(field) {
  if (!field || typeof field !== 'object') return z.any()
  const describe = value => (typeof field.description === 'string' && field.description)
    ? value.describe(field.description)
    : value
  switch (field.type) {
    case 'string':
      return describe(z.string())
    case 'number':
    case 'integer':
      return describe(z.number())
    case 'boolean':
      return describe(z.boolean())
    case 'array':
      return describe(z.array(z.any()))
    case 'object':
      return describe(z.object({}).passthrough())
    default:
      return describe(z.any())
  }
}

/** 移除上一轮桥接注册的工具，保证插件启停即时生效 */
async function removeBridgedTools() {
  if (bridgedTools.size === 0) return
  const { unregisterTool } = await import('./tools/registry.js')
  for (const name of bridgedTools.keys()) unregisterTool(name)
  bridgedTools = new Map()
}

/**
 * 同步 PluginHost 工具到 Agent 工具注册表。每次 createAgent 前调用。
 * @returns {Promise<number>} 本轮桥接的工具数
 */
export async function syncPluginTools(injectedHost) {
  try {
    const host = injectedHost || await getHost()
    if (!host) return 0

    await host.start()
    await removeBridgedTools()

    const existing = new Set(listToolNames())
    const defs = host.listTools().filter(def => {
      if (!def || typeof def.name !== 'string') return false
      // 跳过宿主内置的知识检索工具（日常对话已有内置 retrieve_knowledge）
      if (def.name.startsWith(INTERNAL_TOOL_PREFIX)) return false
      return true
    })

    for (const def of defs) {
      const bridgeName = `${BRIDGE_PREFIX}${def.name}`
      if (existing.has(bridgeName)) {
        // 与内置工具同名的极端情况，跳过避免污染
        continue
      }
      const full = host.tools?.get?.(def.name) || {}
      const description = `${def.description || def.name}\n\n【来源】来自用户添加的插件。` +
        '调用时参数必须与工具描述一致；该工具执行的是插件提供的能力。'

      registerTool({
        name: bridgeName,
        description,
        schema: jsonSchemaToZod(full.parameters),
        handler: async (args, ctx) => {
          const result = await host.invokeTool(def.name, args || {})
          if (result?.isError) {
            throw new Error(result.text || `插件工具 ${def.name} 执行失败`)
          }
          return result.text || ''
        },
        // 第三方插件不在项目可信边界内，写操作一律要求用户审批
        meta: { requireApproval: true }
      })
      bridgedTools.set(bridgeName, true)
    }

    log.info(`插件桥接完成: ${bridgedTools.size} 个工具`)
    return bridgedTools.size
  } catch (error) {
    log.warn(`插件工具桥接失败（已降级为无插件）: ${error.message}`)
    return 0
  }
}

/**
 * 在每轮对话中触发插件事件。
 * - session/event：让知识注入插件开始异步检索（形状对齐 isUserInputEvent）
 * - agent/pre-step：把已完成的检索结果并入本轮输入
 *
 * @param {Object} options
 * @param {string} options.sessionId 当前对话 session id（复用为插件 agent id）
 * @param {string} options.text 本轮用户输入文本
 * @param {Array} options.messages 待传给 Agent 的消息数组（会被原地可能替换）
 * @returns {Promise<Object>} { messages, agent } 供调用方决定是否替换输入
 */
export async function runPluginPreStep({ sessionId, text, messages, injectedHost }) {
  const result = { messages, agent: null }
  try {
    const host = injectedHost || await getHost()
    if (!host) return result

    await host.start()
    const agent = host.agents?.getOrCreate?.(sessionId || 'default')
    if (!agent) return result
    result.agent = agent
    host.agents?.setCurrent?.(agent.id)

    // 取出上一轮 pre-step 未消费、由 agent.inject() 排队的注入消息，
    // 插入到最后一条用户输入之前，避免知识晚一拍才生效。
    const carried = typeof agent.takeInjected === 'function' ? agent.takeInjected() : []
    if (carried.length) {
      const injectedMessages = carried
        .filter(message => message && (message.role === 'user' || message.role === 'system'))
        .map(message => ({ role: message.role, content: message.content }))
      if (injectedMessages.length) {
        let insertAt = messages.length
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (messages[i]?.role === 'user') { insertAt = i; break }
        }
        messages = [
          ...messages.slice(0, insertAt),
          ...injectedMessages,
          ...messages.slice(insertAt)
        ]
        result.messages = messages
        log.info(`合并上一轮遗留注入消息: ${injectedMessages.length} 条`)
      }
    }

    const seq = Date.now()
    await host.emit('session/event', { id: agent.id }, {
      type: 'user/message',
      seq,
      time: seq,
      data: {
        content: [{ type: 'text', text: String(text || '') }],
        source: { kind: 'user' }
      }
    })

    const initial = { kind: 'enter', messages }
    const decision = await host.waterfall(
      'agent/pre-step',
      { messages, agent },
      initial
    )
    if (decision && Array.isArray(decision.messages)) {
      result.messages = decision.messages
      log.info(`插件 pre-step 合并消息: ${decision.messages.length} 条`)
    }
  } catch (error) {
    log.warn(`插件 pre-step 失败（不影响对话）: ${error.message}`)
  }
  return result
}
