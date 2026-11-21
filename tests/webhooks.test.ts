import assert from 'node:assert/strict'
import { PushManager } from '../src/push.js'
import { normalizeConfig } from '../src/config.js'
import type { DeviceStore } from '../src/devices.js'

const originalFetch = globalThis.fetch
const calls: Array<{ url: string; init?: RequestInit }> = []

globalThis.fetch = async (input, init) => {
  calls.push({ url: String(input), init })
  return new Response('ok', { status: 200 })
}

const devices = { pushDevices: () => [] } as unknown as DeviceStore

try {
  const config = normalizeConfig({
    push: {
      provider: 'none',
      webhooks: [
        { name: 'wecom', url: 'https://qyapi.weixin.qq.com/hook?key=k', format: 'wecom' },
        { name: 'ntfy', url: 'https://ntfy.sh/dsh-test', format: 'ntfy' },
        { name: 'generic', url: 'https://example.com/hook', format: 'generic' },
      ],
      webhookCooldownMs: 60_000,
      webhookContent: 'minimal',
    },
  })
  const manager = new PushManager(config, devices, { info() {}, warn() {} }, undefined, 'plugin:http://host')

  manager.notify('question', {
    id: 'q-1',
    sessionId: 'session-a',
    questions: [{ question: '这是一条不应出现在通知里的问题' }],
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 3, 'one request per webhook target')

  const wecom = calls.find(call => call.url.includes('qyapi'))
  const wecomBody = JSON.parse(String(wecom?.init?.body)) as { msgtype: string; markdown: { content: string } }
  assert.equal(wecomBody.msgtype, 'markdown')
  assert.ok(!wecomBody.markdown.content.includes('不应出现'), 'minimal content keeps the question text out')

  const ntfy = calls.find(call => call.url.includes('ntfy'))
  assert.equal(new Headers(ntfy?.init?.headers).get('title'), 'dsh asks a question')

  const generic = calls.find(call => call.url.includes('example.com'))
  const genericBody = JSON.parse(String(generic?.init?.body)) as { kind: string; data: Record<string, string> }
  assert.equal(genericBody.kind, 'question')
  assert.equal(genericBody.data.questionId, 'q-1')

  manager.notify('question', { id: 'q-2', sessionId: 'session-b', questions: [] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 3, 'the cooldown suppresses a second send within the window')

  console.log('webhook fan-out, minimal content and cooldown: ok')
} finally {
  globalThis.fetch = originalFetch
}
