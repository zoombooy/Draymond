import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterYamlItems,
  isRemovedInvariantLine,
  isTimeContextLine,
  migrateYaml,
  migratePackageJson
} from '../migrate-harness-config.mjs'

test('识别已移除的运行时不变式条目', () => {
  assert.equal(isRemovedInvariantLine('- name: "@deepseek-ai/dsh-invariants"'), true)
  assert.equal(isRemovedInvariantLine("  - name: '@scope/foo/invariant'"), true)
  assert.equal(isRemovedInvariantLine('- id: agent-loop-invariant'), true)
  assert.equal(isRemovedInvariantLine('- id: mcp-happy-friday'), false)
})

test('识别失效的 time-context 覆盖', () => {
  assert.equal(isTimeContextLine('- id: time-context'), true)
  assert.equal(isTimeContextLine('    id: time-context'), true)
  assert.equal(isTimeContextLine('- id: schedule'), false)
})

test('递归过滤嵌套列表中的旧条目，保留兄弟条目', () => {
  const lines = [
    '- id: llm-deepseek',
    '  disabled: true',
    '- insert:',
    '  - id: invariants',
    '    name: "@deepseek-ai/dsh-invariants"',
    '  - id: mcp-happy-friday',
    '    name: "@deepseek-ai/dsh-mcp-client"',
    '- id: ui-settings-models',
    '  disabled: true'
  ]
  const result = filterYamlItems(lines, 0, isRemovedInvariantLine)
  assert.equal(result.includes('  - id: invariants'), false)
  assert.equal(result.includes('    name: "@deepseek-ai/dsh-invariants"'), false)
  assert.equal(result.includes('  - id: mcp-happy-friday'), true)
  assert.equal(result.includes('    name: "@deepseek-ai/dsh-mcp-client"'), true)
  assert.equal(result.includes('- id: llm-deepseek'), true)
  assert.equal(result.includes('- id: ui-settings-models'), true)
})

test('migrateYaml 同时清理不变式与 time-context', () => {
  const text = [
    '- id: time-context',
    '  options: {}',
    '- id: mcp-happy-friday',
    '  name: "@deepseek-ai/dsh-mcp-client"',
    ''
  ].join('\n')
  const { text: next, changed } = migrateYaml(text)
  assert.equal(changed, true)
  assert.equal(next.includes('time-context'), false)
  assert.equal(next.includes('mcp-happy-friday'), true)
})

test('migrateYaml 对新配置保持不变', () => {
  const text = '- id: schedule\n  enabled: true\n'
  assert.deepEqual(migrateYaml(text), { text, changed: false })
})

test('migratePackageJson 移除退役 bundle 且保留其他字段', () => {
  const source = JSON.stringify({
    dependencies: { foo: '1.0.0' },
    'dsh.profile': {
      bundles: [
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-experimental-schedule-bundle',
        '@deepseek-ai/dsh-web-app'
      ]
    }
  }, null, 2)
  const { text, changed } = migratePackageJson(source)
  assert.equal(changed, true)
  const parsed = JSON.parse(text)
  assert.deepEqual(parsed['dsh.profile'].bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app'
  ])
  assert.equal(parsed.dependencies.foo, '1.0.0')
})

test('migratePackageJson 对无关 manifest 保持不变', () => {
  const text = '{"name":"demo"}\n'
  assert.deepEqual(migratePackageJson(text), { text, changed: false })
})
