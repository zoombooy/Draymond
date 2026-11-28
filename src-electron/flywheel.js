/**
 * 数据飞轮：诊断 → 候选 → 评测 → 晋升
 * ====================================
 * 把 agent_tool_logs / agent_feedback 的观测信号回流成对 Skill 的改进。
 *
 * 设计要点：
 *  - 诊断：读工具健康度 + 反馈，定位高失败率 / 高重试率 / 被拒绝 / 负反馈集中在哪些工具，
 *    生成给 LLM 的改进指令。
 *  - 候选：让 LLM 基于诊断 + 现有 SKILL.md 产出改进版，写入候选区（不覆盖正式技能）。
 *  - 评测：用项目自己的 LLM 通道做轻量触发率 A/B（对比 baseline / candidate 描述），
 *    避免依赖 skill-creator 脚本所需的外部 claude -p CLI。
 *  - 晋升：通过阈值才把候选覆盖到正式 SKILL 目录，旧版留档可回滚。
 *  - Tool / Plugin 不涉及热替换，飞轮对它们只产出建议，不自动晋升。
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { loadConfig } from './config.js'
import { getAgentRootDir } from './agent/backend.js'
import { getSkillDir, listSkills, generateSkillIndex, parseSkillMetadata, isBuiltinSkill } from './agent/skills.js'
import { getToolHealth } from './agent/memory.js'
import * as db from './db.js'
import { buildChatCompletionsUrl } from './openaiUrl.js'
import { createLogger } from './agent/logger.js'

const log = createLogger('Flywheel')

// 候选区 / 备份区（都在 agent root 下，不进入 /SKILL/ 扫描路径）
function candidatesDir() { return path.join(getAgentRootDir(), 'flywheel', 'candidates') }
function backupsDir() { return path.join(getAgentRootDir(), 'flywheel', 'backups') }

function readSkillMd(skillId) {
  // 只允许简单目录名，防止路径穿越
  if (!/^[A-Za-z0-9_-]+$/.test(skillId || '')) throw new Error('非法的 skillId')
  const dir = getSkillDir()
  const candidatePaths = [
    path.join(dir, skillId, 'SKILL.md'),
    path.join(dir, `${skillId}.md`)
  ]
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return { content: fs.readFileSync(p, 'utf-8'), filePath: p, isDir: p.endsWith('SKILL.md') }
  }
  return null
}

// ========== 非流式 LLM 调用（复用 generateTitle 的模式） ==========

async function callLlm(model, systemPrompt, userPrompt, { maxTokens = 1200, timeoutMs = 60000 } = {}) {
  const url = buildChatCompletionsUrl(model?.baseUrl)
  if (!url || !model?.apiKey || !model?.modelName) {
    throw new Error('未配置可用的大模型（需要 baseUrl / apiKey / modelName）')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`LLM 请求失败 (${response.status}): ${text.slice(0, 200)}`)
    }
    const parsed = await response.json()
    return parsed?.choices?.[0]?.message?.content?.trim() || ''
  } finally {
    clearTimeout(timer)
  }
}

function stripCodeFence(text) {
  if (!text) return ''
  return text.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
}

// ========== 第一步：诊断 ==========

/**
 * 从观测数据诊断改进方向。纯数据计算，不调用 LLM。
 * @returns {{health:Array, feedback:Object, signals:Array, prompt:string}}
 */
export function diagnose() {
  const health = getToolHealth({ days: 30, limit: 50 })
  const feedback = db.listFeedback({ limit: 500 })

  const feedbackStats = {
    total: feedback.length,
    copied: feedback.filter(f => f.type === 'answer_copied').length,
    discarded: feedback.filter(f => f.type === 'answer_discarded').length,
    approvalRejected: feedback.filter(f => f.type === 'approval_rejected').length,
    rating: feedback.filter(f => f.type === 'rating').length
  }

  const signals = []
  for (const tool of health) {
    if (tool.failureRate >= 0.2) {
      signals.push({ kind: 'failure', tool: tool.toolName, value: tool.failureRate, detail: `失败率 ${(tool.failureRate * 100).toFixed(1)}%（${tool.failures}/${tool.calls} 次）` })
    }
    if (tool.retryRate >= 0.3) {
      signals.push({ kind: 'retry', tool: tool.toolName, value: tool.retryRate, detail: `重试率 ${(tool.retryRate * 100).toFixed(1)}%（模型对同一工具反复调用）` })
    }
    if (tool.p95DurationMs >= 10000) {
      signals.push({ kind: 'slow', tool: tool.toolName, value: tool.p95DurationMs, detail: `P95 耗时 ${(tool.p95DurationMs / 1000).toFixed(1)}s` })
    }
  }
  for (const f of feedback) {
    if (f.type === 'approval_rejected' && f.toolName) {
      signals.push({ kind: 'approval', tool: f.toolName, value: 1, detail: `工具调用被用户拒绝${f.metadata?.reason ? `：${String(f.metadata.reason).slice(0, 80)}` : ''}` })
    }
  }
  // 同一工具的多条信号合并计数，按严重程度排序
  const byTool = new Map()
  for (const s of signals) {
    const entry = byTool.get(s.tool) || { tool: s.tool, count: 0, details: [] }
    entry.count++
    entry.details.push(s.detail)
    byTool.set(s.tool, entry)
  }
  const ranked = [...byTool.values()].sort((a, b) => b.count - a.count).slice(0, 8)

  const promptLines = [
    '你是 Skill 优化诊断器。以下是从真实 Agent 运行日志和反馈中聚合出的改进信号：',
    '',
    `工具健康度（近 30 天，共 ${health.length} 个工具有调用记录）：`,
    health.slice(0, 12).map(t => `- ${t.toolName}: 调用 ${t.calls} 次，失败率 ${(t.failureRate * 100).toFixed(1)}%，重试率 ${(t.retryRate * 100).toFixed(1)}%，P95 ${t.p95DurationMs}ms`).join('\n') || '- （暂无工具调用数据）',
    '',
    `反馈信号：复制 ${feedbackStats.copied} 次 / 回滚 ${feedbackStats.discarded} 次 / 审批拒绝 ${feedbackStats.approvalRejected} 次`,
    '',
    '重点问题工具：',
    ranked.map(r => `- ${r.tool}（${r.count} 条信号）：${r.details.join('；')}`).join('\n') || '- （信号不足，请基于健康度数据给出通用改进方向）'
  ].join('\n')

  return { health, feedback: feedbackStats, signals: ranked, prompt: promptLines }
}

// ========== 第二步：生成候选 ==========

function buildCandidateSystemPrompt() {
  return [
    '你是 Skill 迭代优化专家。你会收到一份来自真实运行数据的诊断报告，以及一个现有 Skill 的 SKILL.md 原文。',
    '请输出改进后的完整 SKILL.md（必须保留 YAML front matter 的 name 和 description 字段，description 要更精准地覆盖用户真实意图，正文要针对诊断出的问题改进 steps）。',
    '只输出 SKILL.md 文件内容本身，不要解释，不要包裹在代码块里。',
    '改进要有针对性：如果诊断显示工具反复重试，就补充参数校验/失败处理指引；如果审批被拒，就补充风险评估与最小权限说明；如果失败率高，就补充前置条件检查。',
    '保持原有能力不丢失，不要凭空删除章节。'
  ].join('\n')
}

async function generateCandidate({ skillId, model, diagnosis }) {
  const current = readSkillMd(skillId)
  if (!current) throw new Error(`找不到技能 ${skillId} 的 SKILL.md`)
  const improved = await callLlm(model, buildCandidateSystemPrompt(),
    `【诊断报告】\n${diagnosis.prompt}\n\n【目标技能】${skillId}\n\n【现有 SKILL.md】\n${current.content}`,
    { maxTokens: 4000, timeoutMs: 120000 })
  const content = stripCodeFence(improved)
  if (!content.includes('description:')) throw new Error('LLM 产出的候选缺少 description 字段，已放弃')

  const dir = path.join(candidatesDir(), skillId)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'SKILL.md')
  fs.writeFileSync(filePath, content, 'utf-8')
  const meta = parseSkillMetadata(content, skillId)
  return { skillId, filePath, content, description: meta?.description || '', basedOn: current.filePath }
}

// ========== 第三步：评测（触发率 A/B） ==========

const QUERY_SYSTEM_PROMPT = [
  '你是 Skill 触发判定器。给定一个 Skill 的 description 和一条用户请求，判断这条请求是否应该触发该 Skill。',
  '只回答 YES 或 NO，不要输出其他内容。判断标准：用户请求是否落在该 Skill 描述的能力范围内。'
].join('\n')

function buildEvalQueries(diagnosis, skillId) {
  // 从诊断信号 + 技能名构造一组正反例 query，避免依赖外部评测集
  const positives = [
    `帮我做一个和 ${skillId} 相关的任务`,
    '这个流程能不能沉淀下来下次复用',
    '把刚才的处理方法整理成可复用的能力'
  ]
  const negatives = ['今天天气怎么样', '帮我写一首关于秋天的诗', '1 + 1 等于几']
  return [...positives, ...negatives].map((q, i) => ({ id: i, query: q, expect: i < positives.length ? 'YES' : 'NO' }))
}

async function judgeTrigger(model, description, query) {
  const answer = await callLlm(model, QUERY_SYSTEM_PROMPT,
    `【Skill description】\n${description}\n\n【用户请求】\n${query}`,
    { maxTokens: 10, timeoutMs: 30000 })
  return /^\s*YES\b/i.test(answer) ? 'YES' : /^\s*NO\b/i.test(answer) ? 'NO' : 'UNKNOWN'
}

/** 评测汇总纯函数：便于单测验证阈值判断 */
export function summarizeEvaluation(skillId, rows) {
  const matched = rows.filter(r => r.after === r.expect).length
  const beforeMatched = rows.filter(r => r.before === r.expect).length
  const total = rows.length || 1
  const afterRate = Number((matched / total).toFixed(3))
  const beforeRate = Number((beforeMatched / total).toFixed(3))
  return {
    skillId,
    queries: rows,
    baselineRate: beforeRate,
    candidateRate: afterRate,
    delta: Number((afterRate - beforeRate).toFixed(3)),
    passed: afterRate >= 0.8 && afterRate > beforeRate
  }
}

async function evaluateCandidate({ skillId, candidate, model }) {
  const baselineSkill = readSkillMd(skillId)
  const baselineDesc = baselineSkill ? (parseSkillMetadata(baselineSkill.content, skillId)?.description || '') : ''
  const queries = buildEvalQueries(null, skillId)
  const rows = []
  for (const q of queries) {
    const before = await judgeTrigger(model, baselineDesc, q.query)
    const after = await judgeTrigger(model, candidate.description, q.query)
    rows.push({ query: q.query, expect: q.expect, before, after, improved: after === q.expect && before !== q.expect })
  }
  return summarizeEvaluation(skillId, rows)
}

// ========== 第四步：晋升 / 回滚 ==========

function backupCurrent(skillId) {
  const current = readSkillMd(skillId)
  if (!current) return null
  const stamp = Date.now().toString()
  const dir = path.join(backupsDir(), skillId, stamp)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, path.basename(current.filePath))
  fs.copyFileSync(current.filePath, file)
  return { dir, file, content: current.content, filePath: current.filePath }
}

function promoteCandidate(skillId, candidate, backup) {
  if (!backup) throw new Error('没有可晋升的正式技能文件')
  fs.copyFileSync(candidate.filePath, backup.filePath)
  generateSkillIndex()
  return { skillId, promotedAt: new Date().toISOString(), backupDir: backup.dir }
}

function rollbackPromotion(skillId, backupDir) {
  if (!backupDir || !path.isAbsolute(backupDir)) throw new Error('无效的备份目录')
  const backupFile = path.join(backupDir, 'SKILL.md')
  const mdFile = path.join(backupDir, `${skillId}.md`)
  const src = fs.existsSync(backupFile) ? backupFile : fs.existsSync(mdFile) ? mdFile : null
  if (!src) throw new Error('备份文件不存在')
  const current = readSkillMd(skillId)
  if (!current) throw new Error('找不到当前技能文件，无法回滚')
  fs.copyFileSync(src, current.filePath)
  generateSkillIndex()
  return { skillId, rolledBackAt: new Date().toISOString() }
}

// ========== 编排：跑完整流程 ==========

/**
 * 跑一次诊断→候选→评测→晋升。
 * 内置技能不允许自动晋升（它们由 public/skills 同步覆盖）。
 * @param {Object} args { skillId, model, autoPromote? }
 * @param {Object} dbApi 注入的数据库接口（便于测试）
 */
export async function runOptimization({ skillId, model, autoPromote = true }, dbApi) {
  if (!skillId) throw new Error('缺少 skillId')
  if (isBuiltinSkill(skillId)) return { error: '内置技能不允许自动改写，请复制为自定义技能后再优化', builtin: true }

  const store = dbApi || db
  const run = store.createFlywheelRun({ skillId, status: 'diagnosing' })

  try {
    // 1. 诊断
    const diagnosis = diagnose()
    store.updateFlywheelRun(run.id, { status: 'diagnosed', diagnosis })

    // 2. 候选
    const candidate = await generateCandidate({ skillId, model, diagnosis })
    store.updateFlywheelRun(run.id, { status: 'candidate_ready', candidate })

    // 3. 评测
    const evaluation = await evaluateCandidate({ skillId, candidate, model })
    store.updateFlywheelRun(run.id, { status: 'evaluated', evaluation })

    // 4. 晋升（阈值通过 + 显式允许）
    let promotion = null
    if (autoPromote && evaluation.passed) {
      const backup = backupCurrent(skillId)
      if (!backup) throw new Error('晋升前备份失败')
      promotion = promoteCandidate(skillId, candidate, backup)
      store.updateFlywheelRun(run.id, { status: 'promoted', promoted: true, promotion })
    } else {
      store.updateFlywheelRun(run.id, {
        status: evaluation.passed ? 'awaiting_promotion' : 'rejected',
        error: evaluation.passed ? null : '评测未达阈值（触发准确率需 ≥80% 且优于基线）'
      })
    }

    return { runId: run.id, diagnosis, candidate, evaluation, promotion }
  } catch (e) {
    log.error(`优化运行失败 runId=${run.id}: ${e.message}`)
    store.updateFlywheelRun(run.id, { status: 'failed', error: e.message })
    return { runId: run.id, error: e.message }
  }
}

/**
 * 手动晋升一个已评测但未晋升的运行
 */
export function promoteRun(runId, dbApi) {
  const store = dbApi || db
  const run = store.getFlywheelRun(runId)
  if (!run) throw new Error('运行记录不存在')
  if (run.promoted) throw new Error('该运行已晋升过')
  if (run.status !== 'awaiting_promotion') throw new Error(`当前状态 ${run.status} 不允许晋升`)
  if (!run.candidate?.filePath) throw new Error('候选文件缺失')
  const backup = backupCurrent(run.skillId)
  if (!backup) throw new Error('晋升前备份失败')
  const promotion = promoteCandidate(run.skillId, run.candidate, backup)
  store.updateFlywheelRun(runId, { status: 'promoted', promoted: true, promotion, error: null })
  return promotion
}

/**
 * 回滚一次晋升
 */
export function rollbackRun(runId, dbApi) {
  const store = dbApi || db
  const run = store.getFlywheelRun(runId)
  if (!run) throw new Error('运行记录不存在')
  if (!run.promoted) throw new Error('该运行未晋升')
  if (run.rolledBack) throw new Error('该运行已回滚过')
  const backupDir = run.promotion?.backupDir
  const result = rollbackPromotion(run.skillId, backupDir)
  store.updateFlywheelRun(runId, { status: 'rolled_back', rolledBack: true })
  return result
}
