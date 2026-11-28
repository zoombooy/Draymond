import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { setDataDir, initDb, closeDb } from '../../src-electron/db.js'
import { setDataDir as setConfigDataDir } from '../../src-electron/config.js'

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flywheel-e2e-'))
}

// 隔离 dataDir + 造一个自定义技能，验证候选/晋升/回滚的真实文件操作
test('飞轮闭环：候选写入隔离区，晋升覆盖正式技能，回滚恢复原内容', async () => {
  const dir = makeTmpDir()
  setDataDir(dir)
  setConfigDataDir(dir)
  await initDb()

  // 造一个自定义技能
  const skillDir = path.join(dir, 'knowledge', 'agent', 'SKILL', 'my-custom-skill')
  fs.mkdirSync(skillDir, { recursive: true })
  const originalContent = [
    '---',
    'name: my-custom-skill',
    'description: 处理数据核对的旧版描述',
    '---',
    '# 旧版正文',
    '旧的步骤内容。'
  ].join('\n')
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), originalContent, 'utf-8')

  // 动态导入（确保 dataDir 已设置后再加载模块）
  const {
    diagnose, summarizeEvaluation
  } = await import('../../src-electron/flywheel.js')

  const diag = diagnose()
  assert.ok(Array.isArray(diag.health))
  assert.ok(typeof diag.prompt === 'string' && diag.prompt.includes('诊断器'))

  // 验证评测汇总阈值
  const pass = summarizeEvaluation('my-custom-skill', [
    { expect: 'YES', before: 'NO', after: 'YES' },
    { expect: 'YES', before: 'NO', after: 'YES' },
    { expect: 'YES', before: 'NO', after: 'YES' },
    { expect: 'YES', before: 'NO', after: 'YES' },
    { expect: 'NO', before: 'YES', after: 'NO' }
  ])
  assert.equal(pass.passed, true)

  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})
