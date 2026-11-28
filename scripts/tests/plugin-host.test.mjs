import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginHost } from '../../src-electron/harness/pluginHost.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'o-hino-plugin-host-'))
}

function writePlugin(dir, filename, source) {
  const file = path.join(dir, filename)
  fs.writeFileSync(file, source, 'utf-8')
  return pathToFileURL(file).href
}

function userEvent(seq, text) {
  return {
    type: 'agent/inbox/spliced',
    seq,
    time: Date.now(),
    data: {
      inserted: [{ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }]
    }
  }
}

test('waterfall 审批钩子会阻塞工具直到用户确认', async () => {
  const dir = tempDir()
  const approvalPlugin = writePlugin(dir, 'approval.mjs', `
    export const name = 'test-approval'
    export function apply(ctx) {
      ctx.on('tools/pre-execute', (execution, next) => {
        if (execution.name === 'danger') return { kind: 'ask', reason: '确认执行？' }
        return next()
      })
    }
  `)

  const host = new PluginHost({
    registryFile: path.join(dir, 'bundles.json'),
    builtins: [{ id: 'approval', label: '审批', spec: approvalPlugin }],
    tools: [
      { name: 'danger', handler: () => '已执行' },
      { name: 'safe', handler: () => '放行' }
    ]
  })
  await host.start()

  const pendingRun = host.tools.execute({
    calls: [
      { type: 'tool-call', id: '1', name: 'danger', arguments: '{}' },
      { type: 'tool-call', id: '2', name: 'safe', arguments: '{}' }
    ]
  })
  await sleep(10)

  const pending = host.pendingApprovals()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].name, 'danger')
  assert.equal(pending[0].reason, '确认执行？')

  assert.equal(host.approve(pending[0].id, true), true)
  const result = await pendingRun
  assert.equal(result.results[0].result.content[0].text, '已执行')
  assert.equal(result.results[1].result.content[0].text, '放行')
  assert.equal(host.pendingApprovals().length, 0)
})

test('拒绝审批时工具不执行', async () => {
  const dir = tempDir()
  const approvalPlugin = writePlugin(dir, 'approval.mjs', `
    export function apply(ctx) {
      ctx.on('tools/pre-execute', () => ({ kind: 'ask', reason: '拒绝测试' }))
    }
  `)
  let called = 0
  const host = new PluginHost({
    registryFile: path.join(dir, 'bundles.json'),
    builtins: [{ id: 'approval', spec: approvalPlugin }],
    tools: [{ name: 'write', handler: () => { called += 1; return 'done' } }]
  })
  await host.start()

  const promise = host.tools.execute({ calls: [{ name: 'write', arguments: '{}' }] })
  await sleep(10)
  const pending = host.pendingApprovals()[0]
  assert.ok(pending)
  host.approve(pending.id, false)
  const result = await promise
  assert.equal(result.results[0].result.isError, true)
  assert.equal(called, 0)
})

test('知识插件在本地宿主内走 agent.inject()', async () => {
  const dir = tempDir()
  const spec = pathToFileURL(path.resolve('plugins/o-hino-knowledge/index.js')).href

  const host = new PluginHost({
    registryFile: path.join(dir, 'bundles.json'),
    builtins: [{
      id: 'knowledge',
      spec,
      config: {
        toolName: 'mcp__o-hino__retrieve_knowledge',
        memoryFile: path.join(dir, 'HARNESS.md'),
        preStepTimeoutMs: 300
      }
    }],
    tools: [{
      name: 'mcp__o-hino__retrieve_knowledge',
      handler: () => '【知识片段 1】\n命中：本地 PluginHost'
    }]
  })
  await host.start()

  const agent = host.agents.create('session-1')
  await host.emit('session/event', { id: agent.id }, userEvent(1, '本地插件能用吗'))
  await sleep(30)

  assert.equal(agent.injected.length, 1)
  assert.equal(agent.injected[0].source.kind, 'o-hino-knowledge')
  assert.ok(agent.injected[0].content[0].text.includes('本地 PluginHost'))
})

test('用户 bundle 的增删改与启停直接进入本地宿主', async () => {
  const dir = tempDir()
  const registryFile = path.join(dir, 'bundles.json')
  const pluginSpec = writePlugin(dir, 'demo.mjs', `
    export const name = 'demo'
    export function apply(ctx) { ctx.on('session/event', () => {}) }
  `)

  const host = new PluginHost({ registryFile })
  await host.start()

  const added = await host.addBundle({ spec: pluginSpec, label: '示例插件' })
  assert.equal(added.added, true)
  assert.equal(added.bundle.enabled, true)
  assert.equal(host.list().find(item => item.id === added.bundle.id)?.loaded, true)

  const disabled = await host.toggleBundle(added.bundle.id, false)
  assert.equal(disabled.bundle.enabled, false)
  assert.equal(host.list().find(item => item.id === added.bundle.id)?.loaded, false)

  const removed = await host.removeBundle(added.bundle.id)
  assert.equal(removed.removed, true)
  assert.equal(host.list().some(item => item.id === added.bundle.id), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(registryFile, 'utf-8')), [])
})
