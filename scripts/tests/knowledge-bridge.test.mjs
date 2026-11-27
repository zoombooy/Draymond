import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_HARNESS_MEMORY,
  MEMORY_SECTION_END,
  MEMORY_SECTION_START,
  buildInjectionText,
  extractToolResultText,
  isUserInputEvent,
  memoryEntryFromEvent,
  queryFromEvent,
  upsertMemorySection
} from '../../src-electron/harness/knowledgeBridge.js'

const userMessage = (text, kind = 'user') => ({
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind }
})

const inboxEvent = (messages, extra = {}) => ({
  type: 'agent/inbox/spliced',
  seq: 7,
  time: 1700000000000,
  data: { target: 'next-turn', inserted: messages, ...extra },
  ...extra
})

test('用户输入事件识别与 query 提取', () => {
  const event = inboxEvent([userMessage('总结 Draymond 架构')])
  assert.equal(isUserInputEvent(event), true)
  assert.equal(queryFromEvent(event), '总结 Draymond 架构')

  const direct = {
    type: 'user/message',
    seq: 8,
    time: 1700000000000,
    data: userMessage('继续推进 P2')
  }
  assert.equal(queryFromEvent(direct), '继续推进 P2')
})

test('注入消息与取消投递不会再次触发检索', () => {
  assert.equal(isUserInputEvent(inboxEvent([userMessage('旧结果', 'o-hino-knowledge')])), false)
  assert.equal(isUserInputEvent(inboxEvent([userMessage('已取消')], { outcome: 'canceled' })), false)
  assert.equal(queryFromEvent({ type: 'assistant/message', data: {} }), '')
})

test('注入正文过滤空结果并限制长度', () => {
  assert.equal(buildInjectionText('问题', '未在知识库中检索到相关内容。'), '')
  assert.equal(buildInjectionText('问题', '知识库检索失败: boom'), '')
  assert.equal(buildInjectionText('问题', ''), '')

  const text = buildInjectionText('问题', '【知识片段 1】\n命中内容', { maxChars: 60, maxSnippetChars: 40 })
  assert.ok(text.includes('【知识库检索结果】'))
  assert.ok(text.length <= 60)
})

test('工具批次结果文本提取兼容 content 与 value', () => {
  assert.equal(extractToolResultText({
    results: [{ result: { content: [{ type: 'text', text: '命中内容' }], isError: false } }]
  }), '命中内容')
  assert.equal(extractToolResultText({
    results: [{ result: { content: [], value: 'fallback', isError: false } }]
  }), 'fallback')
  assert.equal(extractToolResultText({
    results: [{ result: { content: [{ type: 'text', text: '错误' }], isError: true } }]
  }), '')
})

test('仅助手消息默认投影，用户原话需要显式开启', () => {
  const assistant = {
    type: 'assistant/message',
    seq: 12,
    time: 1700000000000,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '结论\n分两行' }] } }
  }
  const entry = memoryEntryFromEvent(assistant, 'session-1', { maxChars: 100 })
  assert.deepEqual(entry, {
    seq: 12,
    time: new Date(1700000000000).toISOString(),
    session: 'session-1',
    text: '结论 分两行'
  })

  const directUser = { type: 'user/message', seq: 13, time: 1700000000000, data: userMessage('用户原话') }
  assert.equal(memoryEntryFromEvent(directUser, 'session-1'), null)
  assert.ok(memoryEntryFromEvent(directUser, 'session-1', { captureUser: true }))
})

test('记忆段落幂等写入、去重与容量限制', () => {
  const entry = { seq: 3, time: '2026-11-27T00:00:00.000Z', session: 's1', text: '第一条结论' }
  const first = upsertMemorySection(DEFAULT_HARNESS_MEMORY, [entry], { maxEntries: 5 })
  assert.ok(first.includes('第一条结论'))
  assert.equal(upsertMemorySection(first, [entry], { maxEntries: 5 }), first)

  const second = { ...entry, seq: 4, text: '第二条结论' }
  const appended = upsertMemorySection(first, [second], { maxEntries: 5 })
  assert.equal((appended.match(/hf:s1:/g) || []).length, 2)

  const many = Array.from({ length: 7 }, (_, i) => ({
    seq: 10 + i, time: '2026-11-27T00:00:00.000Z', session: 's2', text: `结论 ${i}`
  }))
  const capped = upsertMemorySection('手动写在标记外的内容', many, { maxEntries: 3 })
  assert.ok(capped.startsWith('手动写在标记外的内容'))
  assert.ok(capped.includes(MEMORY_SECTION_START))
  assert.ok(capped.includes(MEMORY_SECTION_END))
  assert.equal((capped.match(/hf:s2:/g) || []).length, 3)
})
