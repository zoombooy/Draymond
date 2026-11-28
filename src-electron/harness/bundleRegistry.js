/**
 * DSH 第三方 bundle 注册表（第 2 层插件机制）
 * ==========================================
 *
 * 只做纯逻辑：登记用户添加的第三方插件（本地目录绝对路径、.tgz 包或 npm 包名），
 * 生成可写入 cordis patch 的 loader 条目。不碰 Electron / IPC / 文件系统，
 * 便于用 node:test 直接验证。
 *
 * 设计要点：
 *  - bundle 以 `{ id, spec, enabled, label }` 存储；spec 是 file:// URL 或包名。
 *  - 启停通过 patch 里的 `disabled` 字段实现，条目始终存在，切换无需重写结构。
 *  - id 由 spec 派生并加前缀，保证与内置插件 id 不冲突。
 *  - patch 条目形如 `{ id, name, disabled, inject, config }`，与 DSH 原生一致。
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const BUNDLE_ID_PREFIX = 'o-hino-user-'

/** 校验失败时抛出，供 IPC 层转成用户可读错误 */
export class BundleValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BundleValidationError'
  }
}

/**
 * 归一化用户输入的插件位置。
 * - 绝对路径（含 Windows 盘符）→ file:// URL
 * - npm 包名（含 @scope / 版本 / file: / link:）→ 原样
 * @param {string} input
 * @returns {string} 可直接作为 patch name 的 spec
 */
export function normalizeBundleSpec(input, toFileUrl = spec => pathToFileURL(path.resolve(spec)).href) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new BundleValidationError('插件路径或包名不能为空')
  }
  const spec = input.trim()
  if (spec.length > 2048) {
    throw new BundleValidationError('插件路径或包名过长（最多 2048 字符）')
  }
  // 显式协议：file: / link: / npm / git 等交给 DSH loader 解析
  if (/^(file:|link:|npm:|git\+|https?:)/i.test(spec)) return spec
  // Windows 绝对路径 C:\... 或 C:/...，以及 POSIX /... 路径
  if (/^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/') || spec.startsWith('\\\\')) {
    return toFileUrl(spec)
  }
  // 其余按 npm 包名处理，做基本合法性校验
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[\w.^~><=|-]+)?$/i.test(spec)) {
    throw new BundleValidationError(`不是合法的插件路径或包名：${spec}`)
  }
  return spec
}

/** 由 spec 生成稳定 id */
export function bundleIdFromSpec(spec) {
  const slug = spec
    .replace(/^file:\/\//i, '')
    .replace(/^[A-Za-z]:[\\/]/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80)
  return `${BUNDLE_ID_PREFIX}${slug || 'bundle'}`
}

/**
 * 创建一条注册表记录。重复 spec 时保留原有 enabled 状态。
 * @param {Array<object>} registry
 * @param {string} spec
 * @param {object} [options]
 * @param {string} [options.label]
 */
export function addBundle(registry, spec, options = {}) {
  const list = Array.isArray(registry) ? registry.slice() : []
  const id = bundleIdFromSpec(spec)
  const existing = list.find(item => item && item.id === id)
  if (existing) {
    return {
      registry: list.map(item => item === existing
        ? { ...existing, label: options.label || existing.label }
        : item),
      bundle: { ...existing, label: options.label || existing.label },
      added: false
    }
  }
  const bundle = {
    id,
    spec,
    label: typeof options.label === 'string' && options.label.trim()
      ? options.label.trim()
      : spec,
    enabled: options.enabled !== false
  }
  return { registry: [...list, bundle], bundle, added: true }
}

/** 删除一条记录 */
export function removeBundle(registry, id) {
  const list = Array.isArray(registry) ? registry.slice() : []
  const index = list.findIndex(item => item && item.id === id)
  if (index === -1) return { registry: list, removed: false }
  list.splice(index, 1)
  return { registry: list, removed: true }
}

/** 启停一条记录 */
export function setBundleEnabled(registry, id, enabled) {
  const list = Array.isArray(registry) ? registry.slice() : []
  let found = null
  const next = list.map(item => {
    if (!item || item.id !== id) return item
    found = { ...item, enabled: !!enabled }
    return found
  })
  return { registry: next, bundle: found }
}

/**
 * 把注册表投影成 patch 的 `insert` 条目数组。
 * 禁用项也保留条目并置 disabled: true，这样切换只需改一个字段。
 * @param {Array<object>} registry
 */
export function toPatchEntries(registry) {
  if (!Array.isArray(registry)) return []
  return registry
    .filter(item => item && typeof item.id === 'string' && typeof item.spec === 'string')
    .map(item => ({
      id: item.id,
      name: item.spec,
      disabled: item.enabled === false,
      ...(typeof item.inject === 'string' ? { inject: [item.inject] } : {})
    }))
}

/** 读取注册表时做防御性清洗，坏数据不会让 patch 生成失败 */
export function sanitizeRegistry(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || typeof item.spec !== 'string') continue
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push({
      id: item.id,
      spec: item.spec,
      label: typeof item.label === 'string' ? item.label : item.spec,
      enabled: item.enabled !== false,
      ...(Array.isArray(item.inject) && item.inject.length ? { inject: item.inject } : {})
    })
  }
  return out
}
