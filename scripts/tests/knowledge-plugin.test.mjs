import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../../plugins/happy-friday-knowledge/index.js'
import { MEMORY_SECTION_START } from '../../src-electron/harness/knowledgeBridge.js'

function createHarness(overrides = {}) {
  const listeners = {}
  const injected = []
  const calls = []
  const agent = {
    id: 'session-1',
    inject(message) { injected.push(message) }
  }

  const ctx = {
    on(name, listener) {
      (listeners[name] ||= []).push(listener)
    },
    agents: {
      get: () => agent,
      currentInitiator: () => agent
    },
    tools: {
      get: () => ({ name: 'mcp__happy-friday__retrieve_knowledge' }),
      execute: async (input) => {
        calls.push(input)
        return {
          results: [{
            result: {
              isError: false,
              content: [{ type: 'text', text: '【知识片段 1】\n命中：agent.inject 不唤醒 driver' }]
            }
          }]
        }
      }
    },
    logger: { warn() {} },
    ...overrides.ctx
  }

  const emit = (name, ...args) => Promise.all((listeners[name] || []).map(fn => fn(...args)))
  // 同步派发，避免 await 把检索 promise 的 then 提前冲洗掉
  const fire = (name, ...args) => (listeners[name] || []).map(fn => fn(...args))
  return { ctx, emit, fire, injected, calls, agent }
}

function userEvent(seq, text) {
  return {
    type: 'agent/inbox/spliced',
    seq,
    time: Date.now(),
    data: {
      target: 'next-turn',
      inserted: [{ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }]
    }
  }
}

function configFor(tempDir) {
  return {
    toolName: 'mcp__happy-friday__retrieve_knowledge',
    memoryFile: path.join(tempDir, 'HARNESS.md'),
    preStepTimeoutMs: 300
  }
}

test('用户输入触发 MCP 检索并走 agent.inject()', async () => {
  const { ctx, emit, injected, calls } = createHarness()
  apply(ctx, configFor(os.tmpdir()))

  const event = userEvent(1, '总结 Draymond 架构')
  await emit('session/event', { id: 'session-1' }, event)
  // 等待检索 promise 的 then 链完成
  await new Promise(resolve => setTimeout(resolve, 20))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].calls[0].name, 'mcp__happy-friday__retrieve_knowledge')
  assert.equal(JSON.parse(calls[0].calls[0].arguments).query, '总结 Draymond 架构')
  assert.equal(injected.length, 1)
  assert.equal(injected[0].role, 'user')
  assert.equal(injected[0].source.kind, 'happy-friday-knowledge')
  assert.ok(injected[0].content[0].text.includes('【知识库检索结果】'))
})

test('pre-step 消费检索结果后不再重复 inject', async () => {
  const { ctx, fire, injected } = createHarness()
  apply(ctx, configFor(os.tmpdir()))

  const event = userEvent(2, 'P2 怎么注入')
  fire('session/event', { id: 'session-1' }, event)

  const claimed = {
    role: 'user',
    content: [{ type: 'text', text: 'P2 怎么注入' }],
    source: { kind: 'user' }
  }
  const decision = await Promise.all(fire('agent/pre-step', { messages: [claimed], turn: 1, step: 1 }, async () => ({
    kind: 'enter',
    messages: [claimed]
  })))

  assert.equal(decision[0].kind, 'enter')
  assert.equal(decision[0].messages.length, 2)
  assert.ok(decision[0].messages[1].content[0].text.includes('命中'))

  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(injected.length, 0)
})

test('assistant/message 投影到 HARNESS.md 且幂等', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-harness-'))
  const memoryFile = path.join(tempDir, 'HARNESS.md')
  fs.writeFileSync(memoryFile, '# Harness 会话摘录\n\n手动说明\n\n' +
    '<!-- happy-friday-harness-memory:start -->\n' +
    '<!-- happy-friday-harness-memory:end -->\n', 'utf-8')

  const { ctx, emit } = createHarness()
  apply(ctx, configFor(tempDir))

  const event = {
    type: 'assistant/message',
    seq: 9,
    time: Date.now(),
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'P2 的注入分两条通路' }] }
    }
  }
  await emit('session/event', { id: 'session-1' }, event)
  const first = fs.readFileSync(memoryFile, 'utf-8')
  assert.ok(first.includes('P2 的注入分两条通路'))
  assert.ok(first.includes(MEMORY_SECTION_START))
  assert.ok(first.includes('手动说明'))

  await emit('session/event', { id: 'session-1' }, event)
  const second = fs.readFileSync(memoryFile, 'utf-8')
  assert.equal((second.match(/hf:session-1:9/g) || []).length, 1)
})
