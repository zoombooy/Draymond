import assert from 'node:assert/strict'
import test from 'node:test'
import {
  JsonRpcLineClient,
  decodeLine,
  encodeRequest,
  extractText,
  frameError,
  isNotificationFrame,
  isResponseFrame,
  projectSessionEvent,
  projectSessionStatus
} from '../../src-electron/harness/sdkBridge.js'

const userMessage = text => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
const assistantMessage = text => ({ role: 'assistant', content: [{ type: 'text', text }] })

test('行帧编解码与类型判断', () => {
  const frame = encodeRequest(7, 'session/prompt', { sessionId: 's1' })
  assert.equal(frame, '{"jsonrpc":"2.0","id":7,"method":"session/prompt","params":{"sessionId":"s1"}}\n')

  const parsed = decodeLine(frame)
  assert.equal(parsed.id, 7)
  assert.equal(parsed.method, 'session/prompt')
  assert.equal(isResponseFrame(parsed), false)
  assert.equal(isNotificationFrame(parsed), false)

  assert.deepEqual(decodeLine('  \n'), null)
  assert.deepEqual(decodeLine('not json'), null)
  assert.deepEqual(decodeLine('42'), null)
})

test('响应帧关联、错误归一与超时清理', async () => {
  const notifications = []
  const client = new JsonRpcLineClient({ onNotification: m => notifications.push(m), timeoutMs: 1000 })

  const a = client.request('initialize', { cwd: 'C:/tmp' })
  const b = client.request('session/wait', { sessionId: 's1' })
  assert.equal(client.pendingCount, 2)

  client.receive('{"jsonrpc":"2.0","id":2,"result":{"serverInfo":{"name":"x"}}}\n')
  client.receive('{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"unknown method"}}\n')
  assert.deepEqual(await b.promise, { serverInfo: { name: 'x' } })
  await assert.rejects(a.promise, /unknown method/)
  assert.equal(client.pendingCount, 0)

  const error = frameError({ error: { code: 42, message: 'boom' } })
  assert.match(error.message, /42: boom/)
  assert.equal(error.code, 42)
})

test('分块接收与通知分发', () => {
  let seen = null
  const client = new JsonRpcLineClient({ onNotification: m => { seen = m } })
  client.receive('{"method":"session.status","params":{"sessionId":"s1"}}')
  assert.equal(seen, null)
  client.receive('\n{"method":"session.event","params":{"event":{"type":"turn/end"}}}\n')
  assert.equal(seen.method, 'session.event')
  assert.equal(seen.params.event.type, 'turn/end')
})

test('rejectAll 拒绝所有挂起请求', async () => {
  const client = new JsonRpcLineClient()
  const request = client.request('session/prompt', { sessionId: 's' })
  client.rejectAll('transport closed')
  await assert.rejects(request.promise, /transport closed/)
  assert.equal(client.pendingCount, 0)
})

test('session/event 投影为用户与助手消息', () => {
  const base = { sessionId: 's1' }

  const user = projectSessionEvent({ ...base, event: { type: 'user/message', seq: 4, time: 123, data: userMessage('你好') } })
  assert.deepEqual(user, { sessionId: 's1', eventType: 'user/message', seq: 4, time: 123, role: 'user', text: '你好' })

  const inbox = projectSessionEvent({
    ...base,
    event: {
      type: 'agent/inbox/spliced',
      seq: 5,
      data: { inserted: [userMessage('检索到：foo'), { content: [{ type: 'text', text: '注入' }], source: { kind: 'o-hino-knowledge' } }] }
    }
  })
  assert.equal(inbox.role, 'user')
  assert.equal(inbox.text, '检索到：foo')

  const assistant = projectSessionEvent({
    ...base,
    event: { type: 'assistant/message', seq: 9, data: assistantMessage('这是回答') }
  })
  assert.equal(assistant.role, 'assistant')
  assert.equal(assistant.text, '这是回答')

  assert.equal(projectSessionEvent({ ...base, event: { type: 'turn/end' } }), null)
  assert.equal(projectSessionEvent({ event: { type: 'assistant/message', data: assistantMessage('') } }), null)
  assert.equal(extractText('纯字符串'), '纯字符串')
})

test('session.status 投影', () => {
  assert.deepEqual(
    projectSessionStatus({ sessionId: 's1', status: { kind: 'idle', detail: 'ready' } }),
    { sessionId: 's1', kind: 'idle', detail: 'ready' }
  )
  assert.equal(projectSessionStatus({ sessionId: 's1', status: null }), null)
})
