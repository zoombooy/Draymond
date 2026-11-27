/**
 * 知识库注入 / SessionEvent 记忆投影桥接层
 * ==========================================
 *
 * 供 DeepSeek Harness 一等插件使用。本文件不依赖 Electron / LangChain / zod，
 * 全部为纯函数，便于 node:test 离线验证。
 *
 * 两条数据通路：
 *   1. 用户输入 -> 检索 MCP 工具 -> agent.inject() / pre-step 合并 -> 模型可见上下文
 *   2. session/event -> 结构化摘录 -> /memories/HARNESS.md -> Friday 长期记忆
 *
 * 注意：DSH 的 agent.inject() 只把消息排进下一次 pre-step，不会唤醒 driver。
 * 因此插件还要在 agent/pre-step 中把已完成的检索结果并入当前批次，否则
 * 首轮对话会晚一拍才看到知识库内容。
 */

export const INJECTION_SOURCE_KIND = 'o-hino-knowledge'

export const MEMORY_SECTION_START = '<!-- o-hino-harness-memory:start -->'
export const MEMORY_SECTION_END = '<!-- o-hino-harness-memory:end -->'

export const DEFAULT_HARNESS_MEMORY = `# Harness 会话摘录

> DeepSeek Harness 会话中的重要回复会自动投影到此处，供 Friday 跨会话参考。
> 本文件由插件维护，两个标记之间的内容会被覆盖，标记外的内容可以手动编辑。

${MEMORY_SECTION_START}
${MEMORY_SECTION_END}
`

const NO_RESULT_MARKERS = [
  '未在知识库中检索到相关内容',
  '知识库检索失败'
]

/** 从 ContentBlock 数组（或纯字符串）中取出文本块 */
export function extractTextFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/** 从 UserMessage / AssistantMessage 中取出纯文本 */
export function extractMessageText(message) {
  if (!message || typeof message !== 'object') return ''
  return extractTextFromContent(message.content)
}

/** 判断一条 session/event 是否携带新的用户输入 */
export function isUserInputEvent(event) {
  if (!event || typeof event.type !== 'string') return false

  if (event.type === 'agent/inbox/spliced') {
    const data = event.data || {}
    return data.outcome !== 'canceled'
      && Array.isArray(data.inserted)
      && data.inserted.length > 0
      && data.inserted.some(message => message && message.source?.kind === 'user')
  }

  if (event.type === 'user/message') {
    // 注入的消息、runtime-context 等都带自己的 source.kind，不能再次触发检索
    return (event.data?.source?.kind ?? 'user') === 'user'
  }

  return false
}

/** 从用户输入事件中提取检索 query */
export function queryFromEvent(event, options = {}) {
  if (!isUserInputEvent(event)) return ''
  const maxChars = Number.isFinite(options.maxChars) && options.maxChars > 0 ? options.maxChars : 2000

  const messages = event.type === 'agent/inbox/spliced'
    ? (event.data?.inserted || [])
    : [event.data]

  const parts = messages
    .filter(message => message?.source?.kind === 'user')
    .map(extractMessageText)
    .map(text => text.trim())
    .filter(Boolean)

  return parts.join('\n').slice(0, maxChars)
}

/** 判断检索工具是否返回了有效内容 */
export function hasKnowledgeResults(text) {
  if (typeof text !== 'string' || !text.trim()) return false
  return !NO_RESULT_MARKERS.some(marker => text.includes(marker))
}

/**
 * 把检索工具的文本输出包装成注入消息正文。
 * 工具输出本身已含【知识片段 n】/来源/置信度，这里只补标题与问题并限长，
 * 避免把整份知识库内容塞进上下文。
 */
export function buildInjectionText(query, toolText, options = {}) {
  const raw = typeof toolText === 'string' ? toolText : ''
  if (!hasKnowledgeResults(raw)) return ''

  const maxSnippetChars = Number.isFinite(options.maxSnippetChars) && options.maxSnippetChars > 0
    ? options.maxSnippetChars
    : 3000
  const maxChars = Number.isFinite(options.maxChars) && options.maxChars > 0
    ? options.maxChars
    : 4000

  const cleanQuery = String(query || '').trim().slice(0, 200)
  const body = raw.trim().slice(0, maxSnippetChars)
  const header = `【知识库检索结果】\n用户问题：${cleanQuery}\n\n`
  return `${header}${body}`.slice(0, maxChars)
}

/** 从 ctx.tools.execute 的批次结果中取文本；兼容 content / result.content / value */
export function extractToolResultText(batchResult) {
  const settled = batchResult?.results?.[0]?.result ?? batchResult?.results?.[0] ?? batchResult
  if (!settled || settled.isError === true) return ''
  const fromContent = extractTextFromContent(settled.content)
  if (fromContent.trim()) return fromContent.trim()
  if (typeof settled.value === 'string') return settled.value.trim()
  return ''
}

/** 判断一条 session/event 是否值得投影到长期记忆 */
export function shouldProjectEvent(event, options = {}) {
  if (!event || typeof event.type !== 'string') return false

  if (event.type === 'assistant/message') {
    return Boolean(extractMessageText(event.data?.message).trim())
  }

  if (event.type === 'user/message') {
    return options.captureUser === true
      && event.data?.source?.kind === 'user'
      && Boolean(extractMessageText(event.data).trim())
  }

  return false
}

/** 把一条会话事件投影成记忆摘录 */
export function memoryEntryFromEvent(event, sessionId, options = {}) {
  if (!shouldProjectEvent(event, options)) return null

  const maxChars = Number.isFinite(options.maxChars) && options.maxChars > 0 ? options.maxChars : 280
  const raw = extractMessageText(
    event.type === 'assistant/message' ? event.data?.message : event.data
  )
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, maxChars)
  if (!text) return null

  return {
    seq: Number.isFinite(event.seq) ? event.seq : 0,
    time: Number.isFinite(event.time) ? new Date(event.time).toISOString() : new Date().toISOString(),
    session: String(sessionId || 'unknown').slice(0, 24),
    text
  }
}

function formatMemoryLine(entry) {
  return `- <!-- hf:${entry.session}:${entry.seq} --> ${entry.time} · ${entry.text}`
}

function parseMemoryLine(line) {
  const match = line.match(/^-\s*<!--\s*hf:([^:>]+):(\d+)\s*-->\s*(.*)$/)
  if (!match) return null
  return { key: `${match[1]}:${match[2]}`, line }
}

/**
 * 幂等地把新摘录合并进 HARNESS.md。
 * 只替换两个标记之间的内容，标记外的手动编辑保留。
 */
export function upsertMemorySection(existing, entries, options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : 40

  const content = typeof existing === 'string' ? existing : ''
  const startIndex = content.indexOf(MEMORY_SECTION_START)
  const endIndex = content.indexOf(MEMORY_SECTION_END)

  let lines = []
  let prefix = content.trimEnd()
  let suffix = ''

  if (startIndex !== -1 && endIndex > startIndex) {
    const before = content.slice(0, startIndex)
    const sectionBody = content.slice(startIndex + MEMORY_SECTION_START.length, endIndex)
    const after = content.slice(endIndex + MEMORY_SECTION_END.length)
    prefix = before.trimEnd()
    suffix = after.trimStart()
    lines = sectionBody
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseMemoryLine)
      .filter(Boolean)
  } else {
    // 老用户没有该文件/该段落时补一个标准标题
    if (prefix && !prefix.includes('Harness 会话摘录')) {
      prefix = `${prefix}\n\n## Harness 会话摘录\n`
    }
  }

  const seen = new Set(lines.map(item => item.key))
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue
    const key = `${entry.session}:${entry.seq}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push({ key, line: formatMemoryLine(entry) })
  }

  const kept = lines.slice(-maxEntries)
  const section = [
    MEMORY_SECTION_START,
    ...kept.map(item => item.line),
    MEMORY_SECTION_END
  ].join('\n')

  return `${prefix ? `${prefix}\n\n` : ''}${section}${suffix ? `\n\n${suffix}` : '\n'}`
}
