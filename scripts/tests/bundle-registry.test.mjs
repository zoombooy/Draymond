import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUNDLE_ID_PREFIX,
  BundleValidationError,
  addBundle,
  bundleIdFromSpec,
  normalizeBundleSpec,
  removeBundle,
  sanitizeRegistry,
  setBundleEnabled,
  toPatchEntries
} from '../../src-electron/harness/bundleRegistry.js'

const toFileUrl = spec => `file:///${spec.replace(/\\/g, '/')}`

test('normalizeBundleSpec 把 Windows 绝对路径转成 file URL', () => {
  assert.equal(
    normalizeBundleSpec('D:\\plugins\\my-plugin', toFileUrl),
    'file:///D:/plugins/my-plugin'
  )
  assert.equal(
    normalizeBundleSpec('C:/tools/agent', toFileUrl),
    'file:///C:/tools/agent'
  )
})

test('normalizeBundleSpec 保留 npm 包名与显式协议', () => {
  assert.equal(normalizeBundleSpec('@scope/my-plugin'), '@scope/my-plugin')
  assert.equal(normalizeBundleSpec('lodash@1.2.3'), 'lodash@1.2.3')
  assert.equal(normalizeBundleSpec('file:../local-plugin'), 'file:../local-plugin')
  assert.equal(normalizeBundleSpec('link:/opt/plugin'), 'link:/opt/plugin')
})

test('normalizeBundleSpec 拒绝空值与非法字符', () => {
  assert.throws(() => normalizeBundleSpec(''), BundleValidationError)
  assert.throws(() => normalizeBundleSpec('   '), BundleValidationError)
  assert.throws(() => normalizeBundleSpec('bad name!'), BundleValidationError)
  assert.throws(() => normalizeBundleSpec('a'.repeat(2100)), BundleValidationError)
})

test('addBundle 新增记录并生成稳定 id', () => {
  const { registry, bundle, added } = addBundle([], '@scope/my-plugin')
  assert.equal(added, true)
  assert.equal(bundle.enabled, true)
  assert.equal(bundle.label, '@scope/my-plugin')
  assert.ok(bundle.id.startsWith(BUNDLE_ID_PREFIX))
  assert.equal(registry.length, 1)
  assert.equal(bundleIdFromSpec('@scope/my-plugin'), bundle.id)
})

test('addBundle 对相同 spec 幂等并保留 enabled 状态', () => {
  const first = addBundle([], 'file:///D:/plugins/a')
  const disabled = setBundleEnabled(first.registry, first.bundle.id, false)
  const second = addBundle(disabled.registry, 'file:///D:/plugins/a', { label: '新标题' })
  assert.equal(second.added, false)
  assert.equal(second.registry.length, 1)
  assert.equal(second.bundle.enabled, false)
  assert.equal(second.bundle.label, '新标题')
})

test('setBundleEnabled 与 removeBundle 生效', () => {
  const { registry } = addBundle([], '@scope/p')
  const id = registry[0].id
  const toggled = setBundleEnabled(registry, id, false)
  assert.equal(toggled.bundle.enabled, false)
  assert.equal(toggled.registry[0].enabled, false)
  const removed = removeBundle(toggled.registry, id)
  assert.equal(removed.removed, true)
  assert.equal(removed.registry.length, 0)
  assert.equal(removeBundle(removed.registry, id).removed, false)
})

test('toPatchEntries 生成 DSH 原生 patch 条目，禁用项保留 disabled', () => {
  const a = addBundle([], 'file:///D:/plugins/a').registry
  const b = addBundle(a, '@scope/b').registry
  const disabled = setBundleEnabled(b, b[1].id, false).registry
  const entries = toPatchEntries(disabled)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, 'file:///D:/plugins/a')
  assert.equal(entries[0].disabled, false)
  assert.equal(entries[1].name, '@scope/b')
  assert.equal(entries[1].disabled, true)
  for (const entry of entries) {
    assert.equal(typeof entry.id, 'string')
    assert.ok(entry.id.startsWith(BUNDLE_ID_PREFIX))
  }
})

test('sanitizeRegistry 清洗坏数据、去重、保留 inject', () => {
  const clean = sanitizeRegistry([
    { id: 'x', spec: 'pkg-x', label: 'X' },
    { id: 'x', spec: 'pkg-x-dup' },
    null,
    { id: 'y' },
    { id: 'z', spec: 'pkg-z', enabled: false, inject: ['tools'] }
  ])
  assert.equal(clean.length, 2)
  assert.equal(clean[0].spec, 'pkg-x')
  assert.equal(clean[1].enabled, false)
  assert.deepEqual(clean[1].inject, ['tools'])
  assert.deepEqual(sanitizeRegistry(null), [])
})
