import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginHost } from '../../src-electron/harness/pluginHost.js'
import { listToolNames, unregisterTool } from '../../src-electron/agent/tools/registry.js'
import { syncPluginTools, runPluginPreStep } from '../../src-electron/agent/pluginBridge.js'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'o-hino-plugin-bridge-'))
}

function writePlugin(dir, filename, source) {
  const file = path.join(dir, filename)
  fs.writeFileSync(file, source, 'utf-8')
  return pathToFileURL(file).href
}

function makeHost(dir, extraBuiltins = []) {
  return new PluginHost({
    registryFile: path.join(dir, 'bundles.json'),
    builtins: extraBuiltins.map(spec => ({
      id: `builtin-${path.basename(spec)}`,
      label: path.basename(spec),
      spec,
      enabled: true
    }))
  })
}

// 每个用例结束后清理桥接注册，避免污染全局 registry 影响其他测试文件
function cleanupBridged() {
  for (const name of listToolNames()) {
    if (name.startsWith('plugin__')) unregisterTool(name)
  }
}

test('syncPluginTools 把插件工具镜像注册为 plugin__ 前缀且跳过宿主内置工具', async () => {
  const dir = tempDir()
  const spec = writePlugin(dir, 'demo.mjs', `
    export const name = 'demo'
    export function apply(ctx) {
      ctx.tools.register({
        name: 'demo_read',
        description: 'read demo',
        parameters: { type: 'object', properties: { file: { type: 'string', description: 'path' } }, required: ['file'] },
        execute: async (args) => 'read:' + args.file
      })
      ctx.tools.register({
        name: 'mcp__o-hino__retrieve_knowledge',
        description: 'internal',
        parameters: { type: 'object' },
        execute: async () => 'internal'
      })
    }
  `)
  const host = makeHost(dir, [spec])
  await host.start()
  try {
    const count = await syncPluginTools(host)
    const names = listToolNames()
    assert.ok(names.includes('plugin__demo_read'), '插件工具应被桥接注册')
    assert.ok(!names.includes('plugin__mcp__o-hino__retrieve_knowledge'), '宿主内置工具应被跳过')
    assert.equal(count, 1)

    // 桥接工具要求审批（第三方不可信）
    const { buildInterruptConfig } = await import('../../src-electron/agent/tools/registry.js')
    assert.equal(buildInterruptConfig()['plugin__demo_read'], true)
  } finally {
    cleanupBridged()
  }
})

test('桥接工具的 handler 能真正调用到插件工具', async () => {
  const dir = tempDir()
  const spec = writePlugin(dir, 'echo.mjs', `
    export const name = 'echo'
    export function apply(ctx) {
      ctx.tools.register({
        name: 'echo_text',
        description: 'echo text',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        execute: async (args) => 'echo:' + args.text
      })
    }
  `)
  const host = makeHost(dir, [spec])
  await host.start()
  try {
    await syncPluginTools(host)
    const result = await host.invokeTool('echo_text', { text: 'hello' })
    assert.equal(result.isError, false)
    assert.match(result.text, /echo:hello/)
  } finally {
    cleanupBridged()
  }
})

test('再次同步会先注销上一轮桥接工具，插件停用后不再出现', async () => {
  const dir = tempDir()
  const spec = writePlugin(dir, 'once.mjs', `
    export const name = 'once'
    export function apply(ctx) {
      ctx.tools.register({
        name: 'once_tool',
        description: 'once',
        parameters: { type: 'object' },
        execute: async () => 'ok'
      })
    }
  `)
  const host = makeHost(dir, [spec])
  await host.start()
  try {
    await syncPluginTools(host)
    assert.ok(listToolNames().includes('plugin__once_tool'))

    // 卸载插件工具后再次同步，桥接工具应被清理
    host.tools.unregisterOwner(host.list().find(p => p.loaded).id)
    await syncPluginTools(host)
    assert.ok(!listToolNames().includes('plugin__once_tool'), '停用的插件工具应被移除')
  } finally {
    cleanupBridged()
  }
})

test('runPluginPreStep 会把上一轮 agent.inject() 排队的知识插入用户输入之前', async () => {
  const dir = tempDir()
  const host = makeHost(dir, [])
  await host.start()
  const agent = host.agents.getOrCreate('session-carry')
  agent.inject({ role: 'user', content: [{ type: 'text', text: '知识片段' }] })

  const messages = [
    { role: 'user', content: '上一轮' },
    { role: 'assistant', content: '回答' },
    { role: 'user', content: '本轮问题' }
  ]
  const result = await runPluginPreStep({
    sessionId: 'session-carry',
    text: '本轮问题',
    messages,
    injectedHost: host
  })
  assert.equal(result.messages.length, 4)
  assert.deepEqual(result.messages[2], {
    role: 'user',
    content: [{ type: 'text', text: '知识片段' }]
  })
  assert.equal(result.messages[3].content, '本轮问题')
})

test('runPluginPreStep 触发 session/event 并合并 pre-step 注入的消息', async () => {
  const dir = tempDir()
  // 知识插件：收到用户输入后注入一条消息，并在 pre-step 合并
  const spec = writePlugin(dir, 'inject.mjs', `
    export const name = 'inject'
    export function apply(ctx) {
      ctx.on('session/event', (session, event) => {
        if (event?.type !== 'user/message') return
        const agent = ctx.agents.getOrCreate(session.id)
        agent.inject({ role: 'user', content: ' Retrieved knowledge ' })
      })
      ctx.on('agent/pre-step', async (payload, next) => {
        const agent = payload.agent
        return { kind: 'enter', messages: payload.messages }
      })
    }
  `)
  const host = makeHost(dir, [spec])
  await host.start()
  const result = await runPluginPreStep({
    sessionId: 'session-1',
    text: 'question',
    messages: [{ role: 'user', content: 'question' }],
    injectedHost: host
  })
  assert.equal(result.messages.length, 1)
  assert.equal(result.agent.id, 'session-1')
  assert.ok(host.agents.get('session-1'), '插件 session 应被创建')
})
