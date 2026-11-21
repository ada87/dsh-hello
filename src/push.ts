import { createPrivateKey, createSign, sign as cryptoSign } from 'node:crypto'
import { connect } from 'node:http2'
import type { Config, PushConfig, WebhookFormat, WebhookTarget } from './config.js'
import type { CredentialProviderService } from './host.js'
import type { DeviceStore, PushKind } from './devices.js'
import { shortError } from './util.js'

export interface PushPayload {
  title: string
  body: string
  data: Record<string, string>
}

/** Bodies for `webhookContent: 'minimal'`: never carries conversation text. */
const MINIMAL_BODY: Record<PushKind, string> = {
  approval: 'A tool call needs approval',
  question: 'The agent is waiting for an answer',
  'turn-end': 'The agent finished its turn',
}

/**
 * Direct APNs/FCM sender plus outbound webhooks. There is no relay: credentials
 * come from the deployment's own service account or APNs key, so the plugin
 * author never sees user sessions. Webhooks are independent of the app push
 * provider, so a deployment without FCM/APNs still gets notifications.
 */
export class PushManager {
  private fcmToken: { value: string; expiresAt: number } | undefined
  private apnsToken: { value: string; createdAt: number } | undefined
  private remote: Partial<PushConfig> = {}
  /** Last send per `url|kind`, so a burst does not spam one target. */
  private readonly lastWebhook = new Map<string, number>()

  constructor(
    private readonly config: Config,
    private readonly devices: DeviceStore,
    private readonly logger: { info(message: string): void; warn(message: string): void },
    private readonly credentials?: CredentialProviderService,
    private readonly hostId: string = '',
  ) {}

  /**
   * Prefer a `dsh-hello/push` credential record over configuration. Push
   * service-account JSON and APNs keys are secrets, so a deployment that
   * keeps them in the credential store never writes them into cordis.yml.
   */
  async load(): Promise<void> {
    if (this.credentials === undefined) return
    try {
      const record = await this.credentials.readRecord('dsh-hello/push' as unknown)
      const payload = record?.payload
      if (typeof payload === 'object' && payload !== null) this.remote = payload as Partial<PushConfig>
    } catch (error) {
      this.logger.warn(`[dsh-hello] could not read push credentials: ${shortError(error)}`)
    }
  }

  private get push(): PushConfig {
    return { ...this.config.push, ...this.remote }
  }

  isConfigured(): boolean {
    const push = this.push
    if (push.provider === 'relay') {
      return typeof push.relayUrl === 'string' && push.relayUrl.length > 0
        && typeof push.relayHostToken === 'string' && push.relayHostToken.length > 0
    }
    if (push.provider === 'fcm') return typeof push.fcmServiceAccountJson === 'string' && push.fcmServiceAccountJson.length > 0
    if (push.provider === 'apns') {
      return typeof push.apnsKey === 'string' && typeof push.apnsKeyId === 'string' && typeof push.apnsTeamId === 'string' && typeof push.apnsTopic === 'string'
    }
    return false
  }

  /** Register a device token with the relay (direct modes are a no-op). */
  async registerDevice(deviceId: string, provider: 'fcm' | 'apns', token: string): Promise<void> {
    const push = this.push
    if (push.provider !== 'relay' || push.relayUrl === undefined || push.relayHostToken === undefined) return
    try {
      const response = await fetch(`${push.relayUrl.replace(/\/+$/, '')}/v1/devices`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${push.relayHostToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ deviceId, provider, pushToken: token, appVersion: '0.1.2' }),
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`relay ${response.status}: ${text.slice(0, 200)}`)
      }
    } catch (error) {
      this.logger.warn(`[dsh-hello] relay device registration failed: ${shortError(error)}`)
    }
  }

  /** Remove a device binding from the relay. */
  async unregisterDevice(deviceId: string): Promise<void> {
    const push = this.push
    if (push.provider !== 'relay' || push.relayUrl === undefined || push.relayHostToken === undefined) return
    try {
      const response = await fetch(`${push.relayUrl.replace(/\/+$/, '')}/v1/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${push.relayHostToken}` },
      })
      if (!response.ok && response.status !== 404) {
        const text = await response.text()
        throw new Error(`relay ${response.status}: ${text.slice(0, 200)}`)
      }
    } catch (error) {
      this.logger.warn(`[dsh-hello] relay device removal failed: ${shortError(error)}`)
    }
  }

  notify(kind: PushKind, payload: unknown): void {
    const push = this.push
    const enabled = kind === 'approval' ? push.notifyApproval : kind === 'question' ? push.notifyQuestion : push.notifyTurnEnd
    if (!enabled) return
    const toApp = this.isConfigured()
    if (!toApp && push.webhooks.length === 0) return
    const message = render(kind, payload, this.hostId)
    if (toApp) {
      void this.send(message, kind).catch((error: unknown) => {
        this.logger.warn(`[dsh-hello] push failed: ${shortError(error)}`)
      })
    }
    for (const target of push.webhooks) {
      void this.sendWebhook(target, kind, message).catch((error: unknown) => {
        this.logger.warn(`[dsh-hello] webhook ${target.name} failed: ${shortError(error)}`)
      })
    }
  }

  private async sendWebhook(target: WebhookTarget, kind: PushKind, message: PushPayload): Promise<void> {
    const push = this.push
    const key = `${target.url}|${kind}`
    const last = this.lastWebhook.get(key) ?? 0
    if (Date.now() - last < push.webhookCooldownMs) return
    this.lastWebhook.set(key, Date.now())
    const body = push.webhookContent === 'standard' ? message.body : MINIMAL_BODY[kind]
    const signal = AbortSignal.timeout(8000)
    const request = webhookRequest(target.format, target.url, message, body, signal)
    const response = await fetch(request.endpoint, request.init)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`${target.format} ${response.status}: ${text.slice(0, 200)}`)
    }
  }

  private async send(message: PushPayload, kind: PushKind): Promise<void> {
    if (this.push.provider === 'relay') {
      await this.sendRelay(message, kind)
      return
    }
    if (this.push.provider === 'fcm') {
      const targets = this.devices.pushTargets('fcm', kind)
      await Promise.all(targets.map(target => this.sendFcm(target.token, message)))
      return
    }
    if (this.push.provider === 'apns') {
      const targets = this.devices.pushTargets('apns', kind)
      await Promise.all(targets.map(target => this.sendApns(target.token, message)))
    }
  }

  private async sendRelay(message: PushPayload, kind: PushKind): Promise<void> {
    const push = this.push
    if (push.relayUrl === undefined || push.relayHostToken === undefined) {
      throw new Error('relay URL or host token is missing')
    }
    const deviceIds = this.devices.pushDevices(kind).map(device => device.deviceId)
    // No subscribed device means no relay request at all.
    if (deviceIds.length === 0) return
    // Turn-end is scoped to one completed turn, not the whole session. Without
    // eventId, omitting the header is safer than suppressing every later turn.
    const idempotency = message.data.approvalId || message.data.questionId || message.data.eventId || ''
    const response = await fetch(`${push.relayUrl.replace(/\/+$/, '')}/v1/notify`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${push.relayHostToken}`,
        'content-type': 'application/json',
        ...(idempotency.length > 0 ? { 'idempotency-key': `${kind}:${idempotency}` } : {}),
      },
      body: JSON.stringify({
        kind,
        deviceIds,
        title: message.title,
        body: message.body,
        data: message.data,
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`relay ${response.status}: ${text.slice(0, 300)}`)
    }
  }

  private async sendFcm(token: string, message: PushPayload): Promise<void> {
    const serviceAccount = parseServiceAccount(this.push.fcmServiceAccountJson)
    const accessToken = await this.fcmAccessToken(serviceAccount)
    const projectId = this.push.fcmProjectId ?? serviceAccount.project_id
    if (projectId === undefined) throw new Error('FCM project id is missing')
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: message.data,
          android: { priority: 'high' },
        },
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`FCM ${response.status}: ${text.slice(0, 300)}`)
    }
  }

  private async fcmAccessToken(account: ServiceAccount): Promise<string> {
    if (this.fcmToken !== undefined && Date.now() < this.fcmToken.expiresAt) return this.fcmToken.value
    const now = Math.floor(Date.now() / 1000)
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = base64url(JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }))
    const signer = createSign('RSA-SHA256')
    signer.update(`${header}.${claims}`)
    signer.end()
    const assertion = `${header}.${claims}.${signer.sign(account.private_key).toString('base64url')}`
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`FCM token ${response.status}: ${text.slice(0, 300)}`)
    }
    const value = await response.json() as { access_token?: string; expires_in?: number }
    if (typeof value.access_token !== 'string') throw new Error('FCM token response has no access_token')
    this.fcmToken = { value: value.access_token, expiresAt: Date.now() + Math.max(60, (value.expires_in ?? 3600) - 60) * 1000 }
    return value.access_token
  }

  private async sendApns(token: string, message: PushPayload): Promise<void> {
    const push = this.push
    const jwt = this.apnsJwt()
    const host = push.apnsEnvironment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'
    const client = connect(host)
    try {
      await new Promise<void>((resolve, reject) => {
        const request = client.request({
          ':method': 'POST',
          ':path': `/3/device/${encodeURIComponent(token)}`,
          authorization: `bearer ${jwt}`,
          'apns-topic': push.apnsTopic!,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'content-type': 'application/json',
        })
        let status = 0
        let body = ''
        request.on('response', (headers) => {
          status = Number(headers[':status'] ?? 0)
        })
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => { body += chunk })
        request.on('end', () => {
          if (status >= 200 && status < 300) resolve()
          else reject(new Error(`APNs ${status}: ${body.slice(0, 300)}`))
        })
        request.on('error', reject)
        request.end(JSON.stringify({
          aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
          ...message.data,
        }))
      })
    } finally {
      client.close()
    }
  }

  private apnsJwt(): string {
    if (this.apnsToken !== undefined && Date.now() - this.apnsToken.createdAt < 50 * 60 * 1000) return this.apnsToken.value
    const push = this.push
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: push.apnsKeyId }))
    const claims = base64url(JSON.stringify({ iss: push.apnsTeamId, iat: Math.floor(Date.now() / 1000) }))
    const key = createPrivateKey(push.apnsKey!)
    const signature = cryptoSign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' })
    const value = `${header}.${claims}.${signature.toString('base64url')}`
    this.apnsToken = { value, createdAt: Date.now() }
    return value
  }
}

interface ServiceAccount {
  project_id?: string
  client_email: string
  private_key: string
}

function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (raw === undefined) throw new Error('FCM service account JSON is missing')
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('FCM service account JSON must carry client_email and private_key')
  }
  return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function render(kind: 'approval' | 'question' | 'turn-end', payload: unknown, hostId: string): PushPayload {
  if (kind === 'approval') {
    const item = payload as {
      id?: string
      sessionId?: string
      toolName?: string
      reason?: string
      displayReason?: { en?: string }
      preview?: { title?: string; detail?: string }
    }
    const reason = item.preview?.title ?? item.displayReason?.en ?? item.reason ?? ''
    const detail = item.preview?.detail
    const data: Record<string, string> = {
      kind,
      approvalId: item.id ?? '',
      sessionId: item.sessionId ?? '',
      toolName: item.toolName ?? '',
    }
    if (hostId.length > 0) data.hostId = hostId
    if (detail !== undefined) data.preview = truncate(detail, 300)
    return {
      title: 'dsh needs approval',
      body: reason.length > 0 ? `${item.toolName ?? 'tool'}: ${reason}` : `Tool call: ${item.toolName ?? 'unknown'}`,
      data,
    }
  }
  if (kind === 'question') {
    const item = payload as { id?: string; sessionId?: string; questions?: Array<{ question?: string }> }
    const data: Record<string, string> = {
      kind,
      questionId: item.id ?? '',
      sessionId: item.sessionId ?? '',
    }
    if (hostId.length > 0) data.hostId = hostId
    return {
      title: 'dsh asks a question',
      body: truncate(item.questions?.[0]?.question ?? 'Open the app to answer', 160),
      data,
    }
  }
  const item = payload as { sessionId?: string; title?: string; eventId?: string }
  const data: Record<string, string> = { kind, sessionId: item.sessionId ?? '' }
  if (item.eventId !== undefined && item.eventId.length > 0) data.eventId = item.eventId
  if (hostId.length > 0) data.hostId = hostId
  return {
    title: 'dsh finished',
    body: item.title ?? 'The agent finished its turn',
    data,
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

interface WebhookRequest {
  endpoint: string
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }
}

/** One request description per webhook flavour; each target just wants a POST. */
function webhookRequest(
  format: WebhookFormat,
  url: string,
  message: PushPayload,
  body: string,
  signal: AbortSignal,
): WebhookRequest {
  const post = (payload: unknown): WebhookRequest => ({
    endpoint: url,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  })
  switch (format) {
    case 'wecom':
      return post({ msgtype: 'markdown', markdown: { content: `**${message.title}**\n${body}` } })
    case 'serverchan':
      return {
        endpoint: url,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ title: message.title, desp: body }).toString(),
          signal,
        },
      }
    case 'ntfy':
      return {
        endpoint: url,
        init: {
          method: 'POST',
          headers: { 'content-type': 'text/plain', Title: message.title, Tags: 'dsh' },
          body,
          signal,
        },
      }
    case 'bark': {
      // Accept either `https://api.day.app/<key>` or the full `/push` endpoint.
      const parsed = new URL(url)
      const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? ''
      return {
        endpoint: segment === 'push' ? url : new URL('/push', parsed.origin).toString(),
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(segment === 'push' ? {} : { device_key: segment }),
            title: message.title,
            body,
            group: 'dsh',
          }),
          signal,
        },
      }
    }
    default:
      return post({ kind: message.data.kind ?? '', title: message.title, body, data: message.data })
  }
}

