import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildHarnessToolManifest,
  buildApprovalPolicyConfig,
  resolveToolApproval
} from '../../src-electron/harness/toolBridge.js'
import { apply, name as pluginName } from '../../plugins/o-hino-tools/index.js'

const definitions = [
  { name: 'retrieve_knowledge', description: '检索知识库', meta: { exposedViaMcp: true } },
  { name: 'create_note', description: '创建笔记', meta: { exposedViaMcp: true, requireApproval: true } },
  { name: 'shell_exec', description: '执行 shell', meta: { requireApproval: true } },
  { name: 'internal_only', description: '仅内部使用', meta: {} }
]

test('只暴露显式标记的工具，并生成 mcp 工具名', () => {
  const manifest = buildHarnessToolManifest(definitions)
  assert.equal(manifest.toolCount, 2)
  assert.deepEqual(manifest.tools.map(t => t.name), [
    'mcp__o-hino__retrieve_knowledge',
    'mcp__o-hino__create_note'
  ])
})

test('审批工具列表来自同一份清单', () => {
  const manifest = buildHarnessToolManifest(definitions)
  assert.deepEqual(manifest.approvalTools, ['mcp__o-hino__create_note'])
  assert.deepEqual(buildApprovalPolicyConfig(manifest), {
    approvalTools: ['mcp__o-hino__create_note']
  })
})

test('支持自定义 MCP server 名', () => {
  const manifest = buildHarnessToolManifest(definitions, { serverName: 'draymond' })
  assert.equal(manifest.tools[0].name, 'mcp__draymond__retrieve_knowledge')
})

test('审批决策只命中清单内的工具', () => {
  const approvalTools = ['mcp__o-hino__create_note']
  const ask = resolveToolApproval({ name: 'mcp__o-hino__create_note' }, approvalTools)
  assert.equal(ask.kind, 'ask')
  assert.match(ask.reason, /create_note/)
  assert.equal(resolveToolApproval({ name: 'mcp__o-hino__retrieve_knowledge' }, approvalTools), null)
})

test('空清单与异常输入保持安全放行', () => {
  assert.equal(resolveToolApproval({}, []), null)
  assert.equal(resolveToolApproval({ name: 'x' }, undefined), null)
})

test('审批插件在 tools/pre-execute 上拦截需审批工具', async () => {
  const handlers = {}
  const ctx = { on: (event, handler) => { handlers[event] = handler } }
  apply(ctx, { approvalTools: ['mcp__o-hino__create_note'] })
  assert.equal(pluginName, 'o-hino-tool-approval-policy')
  const handler = handlers['tools/pre-execute']
  assert.equal(typeof handler, 'function')
  const decision = await handler({ name: 'mcp__o-hino__create_note' }, () => 'next')
  assert.equal(decision.kind, 'ask')
  const passthrough = await handler({ name: 'mcp__o-hino__get_note' }, () => 'next')
  assert.equal(passthrough, 'next')
})
