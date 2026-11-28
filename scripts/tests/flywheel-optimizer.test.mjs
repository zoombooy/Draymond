import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { setDataDir, initDb, closeDb, logFeedback, createFlywheelRun, updateFlywheelRun, getFlywheelRun, listFlywheelRuns } from '../../src-electron/db.js'
import { logToolCall } from '../../src-electron/agent/memory.js'
import { summarizeEvaluation } from '../../src-electron/flywheel.js'

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flywheel-opt-test-'))
}

test('flywheel_runs 记录可在诊断→候选→评测→晋升各阶段更新', async () => {
  const dir = makeTmpDir()
  setDataDir(dir)
  await initDb()

  const run = createFlywheelRun({ skillId: 'my-skill' })
  assert.equal(run.status, 'diagnosing')
  assert.ok(run.id)

  updateFlywheelRun(run.id, { status: 'diagnosed', diagnosis: { signals: 2, health: [] } })
  updateFlywheelRun(run.id, { status: 'evaluated', evaluation: { passed: true, delta: 0.2 } })
  updateFlywheelRun(run.id, {
    status: 'promoted',
    promoted: true,
    promotion: { backupDir: path.join(dir, 'backup'), promotedAt: '2026-01-01' }
  })

  const fetched = getFlywheelRun(run.id)
  assert.equal(fetched.status, 'promoted')
  assert.equal(fetched.promoted, true)
  assert.deepEqual(fetched.diagnosis, { signals: 2, health: [] })
  assert.equal(fetched.evaluation.passed, true)
  assert.equal(fetched.promotion.backupDir, path.join(dir, 'backup'))

  const list = listFlywheelRuns()
  assert.equal(list.length, 1)
  assert.equal(list[0].skillId, 'my-skill')

  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('评测汇总：触发准确率与阈值判断', () => {
  const rows = [
    { query: 'q1', expect: 'YES', before: 'NO', after: 'YES', improved: true },
    { query: 'q2', expect: 'YES', before: 'YES', after: 'YES', improved: false },
    { query: 'q3', expect: 'YES', before: 'NO', after: 'YES', improved: true },
    { query: 'q4', expect: 'NO', before: 'NO', after: 'NO', improved: false },
    { query: 'q5', expect: 'NO', before: 'YES', after: 'NO', improved: false }
  ]
  const result = summarizeEvaluation('skill-x', rows)
  assert.equal(result.baselineRate, 0.4, '基线命中 2/5')
  assert.equal(result.candidateRate, 1, '候选命中 5/5')
  assert.equal(result.delta, 0.6)
  assert.equal(result.passed, true)

  const weak = summarizeEvaluation('skill-y', [
    { expect: 'YES', before: 'NO', after: 'YES' },
    { expect: 'YES', before: 'NO', after: 'NO' },
    { expect: 'YES', before: 'NO', after: 'NO' },
    { expect: 'YES', before: 'NO', after: 'NO' },
    { expect: 'YES', before: 'NO', after: 'NO' }
  ])
  assert.equal(weak.candidateRate, 0.2)
  assert.equal(weak.passed, false, '准确率不足 80%，不应晋升')

  const noGain = summarizeEvaluation('skill-z', [
    { expect: 'YES', before: 'YES', after: 'YES' },
    { expect: 'YES', before: 'YES', after: 'YES' },
    { expect: 'NO', before: 'NO', after: 'NO' },
    { expect: 'NO', before: 'NO', after: 'NO' },
    { expect: 'NO', before: 'NO', after: 'NO' }
  ])
  assert.equal(noGain.passed, false, '虽达标但无提升，不应晋升')
})
