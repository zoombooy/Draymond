import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { setDataDir, initDb, closeDb, logFeedback, listFeedback } from '../../src-electron/db.js'
import { logToolCall, getToolHealth } from '../../src-electron/agent/memory.js'

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flywheel-test-'))
}

test('工具健康度聚合：调用量 / 失败率 / P95 / 重试率', async () => {
  const dir = makeTmpDir()
  setDataDir(dir)
  await initDb()

  logToolCall({ requestId: 'r1', toolName: 'read_file', status: 'success', durationMs: 10 })
  logToolCall({ requestId: 'r1', toolName: 'read_file', status: 'error', durationMs: 50 })
  logToolCall({ requestId: 'r2', toolName: 'read_file', status: 'success', durationMs: 100 })
  logToolCall({ requestId: 'r3', toolName: 'write_file', status: 'success', durationMs: 20 })

  const health = getToolHealth({ days: 7 })
  const read = health.find(h => h.toolName === 'read_file')
  const write = health.find(h => h.toolName === 'write_file')

  assert.ok(read, 'read_file 应出现在健康度列表')
  assert.equal(read.calls, 3)
  assert.equal(read.failures, 1)
  assert.equal(read.failureRate, 0.3333)
  assert.equal(read.p95DurationMs, 100)
  assert.equal(read.retries, 1, 'r1 内重复调用 read_file 两次，应计为一次重试')
  assert.equal(read.retryRate, 0.5, '两次请求中一次发生重试')
  assert.equal(read.avgDurationMs, 53)

  assert.ok(write)
  assert.equal(write.failures, 0)
  assert.equal(write.p95DurationMs, 20)
  assert.equal(write.retries, 0)

  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('反馈信号可记录并按类型 / 会话查询', async () => {
  const dir = makeTmpDir()
  setDataDir(dir)
  await initDb()

  const rejected = logFeedback({
    runId: 'run-1',
    sessionId: 'sess-1',
    type: 'approval_rejected',
    toolName: 'shell_exec',
    metadata: { reason: '命令风险过高' }
  })
  logFeedback({ sessionId: 'sess-1', type: 'answer_copied', metadata: { messageId: 7 } })
  logFeedback({ sessionId: 'sess-2', type: 'answer_copied' })

  assert.ok(rejected.id)
  assert.equal(rejected.type, 'approval_rejected')

  const rejects = listFeedback({ sessionId: 'sess-1', type: 'approval_rejected' })
  assert.equal(rejects.length, 1)
  assert.equal(rejects[0].toolName, 'shell_exec')
  assert.equal(rejects[0].metadata.reason, '命令风险过高')

  const sessionOne = listFeedback({ sessionId: 'sess-1' })
  assert.equal(sessionOne.length, 2)
  assert.deepEqual(sessionOne.map(f => f.type).sort(), ['answer_copied', 'approval_rejected'])

  const byRun = listFeedback({ runId: 'run-1' })
  assert.equal(byRun.length, 1)

  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})
