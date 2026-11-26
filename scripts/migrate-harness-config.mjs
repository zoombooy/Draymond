/**
 * DeepSeek Harness 0.1.x -> 0.2.x 配置迁移
 * ==========================================
 *
 * 对应官方两条破坏性变更：
 * 1. @deepseek-ai/dsh-invariants 与所有 /invariant 子路径被移除，引用它们的
 *    patch / overlay 会导致 `patch: entry not found`。
 * 2. dsh-experimental-schedule-bundle 退役，schedule / ui-schedule 已由
 *    dsh-web-app 默认挂载；顶层 time-context overlay 不再匹配任何条目。
 *
 * 本脚本只处理 patch 与 profile manifest，不改动用户任务数据。
 * 用法：node scripts/migrate-harness-config.mjs [dataDir]
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const REMOVED_IDS = new Set([
  'invariants',
  'session-invariant',
  'agent-invariant',
  'scope-invariant',
  'agent-loop-invariant'
])

const REMOVED_BUNDLE = '@deepseek-ai/dsh-experimental-schedule-bundle'

/** 判断一个 patch 条目是否引用了 0.2.x 已移除的运行时不变式插件 */
export function isRemovedInvariantLine(line) {
  if (/^\s*-\s+name:\s*['"]?@deepseek-ai\/dsh-invariants['"]?/.test(line)) return true
  if (/^\s*-\s+name:\s*['"][^'"]*\/invariant['"]?\s*$/.test(line)) return true
  const id = line.match(/\bid:\s*['"]?([a-z-]+)['"]?/)
  return Boolean(id && REMOVED_IDS.has(id[1]))
}

/** 判断一个 patch 条目是否是已失效的顶层 time-context 覆盖 */
export function isTimeContextLine(line) {
  return /\bid:\s*['"]?time-context['"]?/.test(line)
}

/**
 * 按缩进取出的 YAML 列表项，递归过滤掉匹配 matcher 的条目。
 * 只依据条目首行判断，避免误删包含嵌套 insert 的父块。
 * @param {string[]} lines
 * @param {number} baseIndent
 * @param {(line: string) => boolean} matcher
 * @returns {string[]}
 */
export function filterYamlItems(lines, baseIndent, matcher) {
  const result = []
  let i = 0
  while (i < lines.length) {
    const indent = lines[i].match(/^(\s*)/)[1].length
    const isItemStart = indent === baseIndent && /^\s*-\s/.test(lines[i])
    if (!isItemStart) {
      result.push(lines[i])
      i += 1
      continue
    }
    const start = i
    i += 1
    while (i < lines.length) {
      const nextIndent = lines[i].match(/^(\s*)/)[1].length
      if (nextIndent === baseIndent && /^\s*-\s/.test(lines[i])) break
      if (nextIndent < baseIndent && lines[i].trim() !== '') break
      i += 1
    }
    const block = lines.slice(start, i)
    if (matcher(block[0])) continue
    result.push(...filterYamlItems(block, baseIndent + 2, matcher))
  }
  return result
}

/** 清理 patch YAML 文本，返回 { text, changed } */
export function migrateYaml(text) {
  const lines = text.split('\n')
  const next = filterYamlItems(
    lines,
    0,
    line => isRemovedInvariantLine(line) || isTimeContextLine(line)
  )
  const result = next.join('\n')
  return { text: result, changed: result !== text }
}

/** 从 profile manifest 中移除退役的 schedule bundle，返回 { text, changed } */
export function migratePackageJson(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { text, changed: false }
  }
  const profile = parsed?.['dsh.profile']
  const bundles = profile && Array.isArray(profile.bundles) ? profile.bundles : null
  if (!bundles || !bundles.includes(REMOVED_BUNDLE)) return { text, changed: false }
  profile.bundles = bundles.filter(name => name !== REMOVED_BUNDLE)
  return { text: `${JSON.stringify(parsed, null, 2)}\n`, changed: true }
}

function backup(file) {
  const backupPath = `${file}.bak-0.1.5-${Date.now()}`
  fs.renameSync(file, backupPath)
  return backupPath
}

function migrateFile(file, migrate) {
  if (!fs.existsSync(file)) return null
  const original = fs.readFileSync(file, 'utf-8')
  const { text, changed } = migrate(original)
  if (!changed) return null
  const backupPath = backup(file)
  fs.writeFileSync(file, text, 'utf-8')
  return { file, backupPath }
}

function listProfileManifests(home) {
  const profilesDir = path.join(home, 'profiles')
  if (!fs.existsSync(profilesDir)) return []
  return fs.readdirSync(profilesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(profilesDir, entry.name, 'package.json'))
    .filter(file => fs.existsSync(file))
}

export function runMigration(dataDir) {
  const home = path.join(dataDir, 'deepseek-harness', 'home')
  const changed = []
  if (fs.existsSync(home)) {
    for (const file of [
      path.join(home, 'happy-friday.patch.yml'),
      path.join(home, 'cordis.patch.yml')
    ]) {
      const result = migrateFile(file, migrateYaml)
      if (result) changed.push(result)
    }
    for (const file of listProfileManifests(home)) {
      const result = migrateFile(file, migratePackageJson)
      if (result) changed.push(result)
    }
  }
  return changed
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const dataDir = process.argv[2]
    || process.env.HAPPY_FRIDAY_DATA_DIR
    || path.join(process.cwd(), 'app-data')
  const changed = runMigration(dataDir)
  if (changed.length === 0) {
    console.log(`[Harness 迁移] ${dataDir} 中没有需要清理的 0.1.x 配置。`)
  } else {
    for (const item of changed) {
      console.log(`[Harness 迁移] 已清理 ${item.file}`)
      console.log(`              原文件备份于 ${item.backupPath}`)
    }
  }
}
