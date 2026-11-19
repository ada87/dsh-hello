import { open } from 'node:fs/promises'
import {
  createWorkspace,
  currentSessionModel,
  listAgentPresets,
  listWorkspaces,
  modelCatalog,
  renameWorkspace,
  selectSessionModel,
  setSessionArchived,
  setSessionPinned,
  uploadAttachment,
  type ModelSelection,
} from './catalogs.js'
import { registerAdminRoutes } from './admin.js'
import { registerInteractionRoutes } from './interaction-routes.js'
import { registerScheduleRoutes } from './schedule-routes.js'
import { registerTerminalRoutes } from './terminal-routes.js'
import { features, requestOrigin, serverFacts } from './server-facts.js'
import { listWorkspaceFiles, listWorkspaceFilesByWorkspace, readWorkspaceFile, readWorkspaceFileByWorkspace, resolveWorkspaceBinary } from './files.js'
import { HttpError, markStreaming, sendJson, sendNoContent, startSse, writeSse } from './http.js'
import type { HttpRouter, RouteContext } from './http.js'
import { parseReadState, tagReadService } from './read-state.js'
import type {
  HealthResponse,
  PairRequest,
  PairResponse,
  SessionListResponse,
  SessionStateResponse,
  SessionTranscriptResponse,
} from './protocol.js'
import { PROTOCOL_VERSION } from './protocol.js'
import type { RouteDependencies } from './route-deps.js'
import { normalizeAnswers } from './route-util.js'
import { speechCatalog, transcribeSpeech } from './speech.js'
import { newId, shortError } from './util.js'

export function registerRoutes(router: HttpRouter, deps: RouteDependencies): void {
  const { config } = deps
  registerAdminRoutes(router, { ...deps, requestOrigin: rc => requestOrigin(deps, rc) })
  registerInteractionRoutes(router, deps)
  registerScheduleRoutes(router, deps)
  registerTerminalRoutes(router, deps)

  router.add({
    method: 'GET',
    pattern: '/health',
    auth: 'public',
    handler: (rc) => {
      const facts = serverFacts(deps, requestOrigin(deps, rc))
      const response: HealthResponse = {
        ok: true,
        ...facts,
        pairingOpen: deps.pairing.status().pairingOpen,
        pairingFixed: deps.pairing.status().fixed,
        deviceCount: deps.devices.count(),
        features: features(deps),
        time: Date.now(),
      }
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/web-url',
    auth: 'device',
    handler: (rc) => {
      const url = deps.webUrl?.() ?? null
      if (url === null) throw new HttpError(503, 'web-url-unavailable', 'this Host does not expose its Web UI URL')
      sendJson(rc.res, 200, { url })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/pair/code',
    auth: 'public',
    handler: async (rc) => {
      assertLoopback(rc)
      const current = deps.pairing.current()
      const origin = serverFacts(deps, requestOrigin(deps, rc)).origin ?? ''
      const payload = JSON.stringify({
        v: 1,
        url: `${origin}${config.basePath}`,
        code: current.code,
      })
      sendJson(rc.res, 200, {
        code: current.code,
        formatted: current.formatted,
        expiresAt: current.expiresAt,
        payload,
      })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/pair/code',
    auth: 'public',
    handler: (rc) => {
      assertLoopback(rc)
      const rotated = deps.pairing.rotate()
      sendJson(rc.res, 200, rotated)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/pair',
    auth: 'public',
    handler: async (rc) => {
      const body = rc.body as Partial<PairRequest> | undefined
      if (body === undefined || typeof body.code !== 'string') {
        throw new HttpError(400, 'bad-pair-request', 'pairing requires a code')
      }
      const verification = deps.pairing.verify(body.code, rc.clientAddress)
      if (!verification.ok) {
        const message = verification.reason === 'locked'
          ? 'this Host is not accepting new devices; unlock pairing in the dsh settings first'
          : verification.reason === 'rate-limited'
            ? 'too many pairing attempts from this address'
            : verification.reason === 'expired'
              ? 'the pairing code has expired; read the new code from the dsh terminal'
              : 'the pairing code is invalid'
        const status = verification.reason === 'locked'
          ? 403
          : verification.reason === 'rate-limited' ? 429 : 401
        throw new HttpError(status, `pair-${verification.reason}`, message)
      }
      const authority = rc.authority
      if (authority.length === 0) throw new HttpError(400, 'missing-host', 'the Host header is required')
      const token = randomPairingToken()
      const device = await deps.devices.pair({
        token,
        deviceName: sanitizeName(body.deviceName),
        devicePublicKey: typeof body.devicePublicKey === 'string' ? body.devicePublicKey : undefined,
        platform: body.platform,
        appVersion: body.appVersion,
        authority,
      })
      const response: PairResponse = {
        deviceId: device.deviceId,
        token,
        deviceName: device.deviceName,
        pairedAt: device.pairedAt,
        server: serverFacts(deps, requestOrigin(deps, rc)),
        features: features(deps),
      }
      deps.logger.info(`[dsh-hello] paired device "${device.deviceName}" (${device.deviceId.slice(0, 12)}…) from ${rc.clientAddress}`)
      sendJson(rc.res, 201, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/devices/me',
    auth: 'device',
    handler: (rc) => {
      const device = deps.devices.list().find(item => item.deviceId === rc.device?.deviceId)
      if (device === undefined) throw new HttpError(404, 'device-not-found', 'this device is no longer paired')
      sendJson(rc.res, 200, { device })
    },
  })

  router.add({
    method: 'DELETE',
    pattern: '/devices/me',
    auth: 'device',
    handler: async (rc) => {
      const deviceId = rc.device!.deviceId
      const removed = await deps.devices.revoke(deviceId)
      if (!removed) throw new HttpError(404, 'device-not-found', 'this device is no longer paired')
      deps.hub.closeDevice(deviceId)
      sendNoContent(rc.res)
    },
  })

  router.add({
    method: 'PUT',
    pattern: '/devices/me/push',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { provider?: unknown; token?: unknown } | undefined
      const provider = body?.provider
      const token = body?.token
      if (provider !== 'fcm' && provider !== 'apns') {
        throw new HttpError(400, 'bad-push-provider', 'provider must be "fcm" or "apns"')
      }
      if (typeof token !== 'string' || token.length < 8 || token.length > 4096) {
        throw new HttpError(400, 'bad-push-token', 'token must be a non-empty push token')
      }
      const updated = await deps.devices.setPush(rc.device!.deviceId, { provider, token, updatedAt: Date.now() })
      if (!updated) throw new HttpError(404, 'device-not-found', 'no such device')
      await deps.push.registerDevice(rc.device!.deviceId, provider, token)
      sendJson(rc.res, 200, { accepted: true, provider })
    },
  })

  router.add({
    method: 'PUT',
    pattern: '/devices/me/push/subscriptions',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { approval?: unknown; question?: unknown; turnEnd?: unknown } | undefined
      if (typeof body?.approval !== 'boolean' || typeof body.question !== 'boolean' || typeof body.turnEnd !== 'boolean') {
        throw new HttpError(400, 'bad-push-subscriptions', 'approval, question and turnEnd must be booleans')
      }
      const subscriptions = { approval: body.approval, question: body.question, turnEnd: body.turnEnd }
      const updated = await deps.devices.setSubscriptions(rc.device!.deviceId, subscriptions)
      if (!updated) throw new HttpError(404, 'device-not-found', 'no such device')
      sendJson(rc.res, 200, { accepted: true, subscriptions })
    },
  })

  router.add({
    method: 'DELETE',
    pattern: '/devices/me/push',
    auth: 'device',
    handler: async (rc) => {
      await deps.devices.clearPush(rc.device!.deviceId)
      await deps.push.unregisterDevice(rc.device!.deviceId)
      sendNoContent(rc.res)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/speech',
    auth: 'device',
    handler: (rc) => {
      sendJson(rc.res, 200, speechCatalog(deps.ctx))
    },
  })

  router.add({
    method: 'POST',
    pattern: '/speech/transcribe',
    auth: 'device',
    // 4 MiB WAV becomes roughly 5.33 MiB of canonical base64 plus JSON.
    maxBodyBytes: 6 * 1024 * 1024,
    handler: async (rc) => {
      const body = rc.body as { audioBase64?: unknown; providerId?: unknown; language?: unknown } | undefined
      if (body === undefined || typeof body.audioBase64 !== 'string') {
        throw new HttpError(400, 'empty-audio', 'audioBase64 is required')
      }
      const result = await transcribeSpeech(deps.ctx, {
        audioBase64: body.audioBase64,
        ...(typeof body.providerId === 'string' && body.providerId.length > 0 ? { providerId: body.providerId } : {}),
        ...(typeof body.language === 'string' && body.language.length > 0 ? { language: body.language } : {}),
      }, rc.signal)
      sendJson(rc.res, 200, result)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions',
    auth: 'device',
    handler: async (rc) => {
      const items = await deps.sessions.list(rc.signal)
      const response: SessionListResponse = { items }
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions',
    auth: 'device',
    handler: async (rc) => {
      const body = (rc.body ?? {}) as { cwd?: unknown; workspaceId?: unknown; agentPreset?: unknown }
      const created = await deps.sessions.create({
        ...(typeof body.cwd === 'string' && body.cwd.length > 0 ? { cwd: body.cwd } : {}),
        ...(typeof body.workspaceId === 'string' && body.workspaceId.length > 0 ? { workspaceId: body.workspaceId } : {}),
        ...(typeof body.agentPreset === 'string' && body.agentPreset.length > 0 ? { agentPreset: body.agentPreset } : {}),
      })
      sendJson(rc.res, 201, created)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/workspaces/:id/raw',
    auth: 'device',
    handler: async (rc) => {
      const path = rc.query.get('path')
      if (path === null || path.length === 0) throw new HttpError(400, 'empty-path', 'path is required')
      const file = await resolveWorkspaceBinary(deps.ctx, { workspaceId: rc.params.id! }, path, rc.signal)
      await sendBinary(rc, file)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/raw',
    auth: 'device',
    handler: async (rc) => {
      const path = rc.query.get('path')
      if (path === null || path.length === 0) throw new HttpError(400, 'empty-path', 'path is required')
      const file = await resolveWorkspaceBinary(deps.ctx, { sessionId: rc.params.id! }, path, rc.signal)
      await sendBinary(rc, file)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/workspaces/:id/files',
    auth: 'device',
    handler: async (rc) => {
      const response = await listWorkspaceFilesByWorkspace(
        deps.ctx,
        rc.params.id!,
        rc.query.get('path') ?? '',
      )
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/workspaces/:id/file',
    auth: 'device',
    handler: async (rc) => {
      const path = rc.query.get('path')
      if (path === null || path.length === 0) throw new HttpError(400, 'empty-path', 'path is required')
      const offset = numberParam(rc.query.get('offset')) ?? 0
      const response = await readWorkspaceFileByWorkspace(deps.ctx, rc.params.id!, path, offset)
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/workspaces',
    auth: 'device',
    handler: (rc) => {
      sendJson(rc.res, 200, { items: listWorkspaces(deps.ctx) })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/workspaces',
    auth: 'device',
    handler: async (rc) => {
      const body = (rc.body ?? {}) as { path?: unknown; title?: unknown }
      if (typeof body.path !== 'string' || body.path.trim().length === 0) {
        throw new HttpError(400, 'workspace-invalid-path', 'a non-empty absolute directory path is required')
      }
      const title = typeof body.title === 'string' && body.title.trim().length > 0
        ? body.title.trim().slice(0, 120)
        : undefined
      try {
        const workspace = await createWorkspace(deps.ctx, body.path.trim(), title)
        sendJson(rc.res, 201, { workspace })
      } catch (error) {
        throw new HttpError(400, 'workspace-create-failed', shortError(error))
      }
    },
  })

  router.add({
    method: 'PUT',
    pattern: '/workspaces/:id',
    auth: 'device',
    handler: async (rc) => {
      const body = (rc.body ?? {}) as { title?: unknown }
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        throw new HttpError(400, 'workspace-invalid-title', 'a non-empty workspace title is required')
      }
      const result = await renameWorkspace(deps.ctx, rc.params.id!, body.title.trim().slice(0, 120))
      if ('code' in result) {
        throw new HttpError(404, 'workspace-not-found', 'the workspace no longer exists')
      }
      sendJson(rc.res, 200, result)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/agent-presets',
    auth: 'device',
    handler: async (rc) => {
      sendJson(rc.res, 200, await listAgentPresets(deps.ctx))
    },
  })

  router.add({
    method: 'GET',
    pattern: '/models',
    auth: 'device',
    handler: async (rc) => {
      sendJson(rc.res, 200, await modelCatalog(deps.ctx))
    },
  })

  // Read watermarks are owned by dsh-tag (colour and weight share one layer);
  // this authenticated route is the phone's way in. Without dsh-tag the
  // feature is simply absent, which the app sees through `features.readState`.
  router.add({
    method: 'GET',
    pattern: '/read-state',
    auth: 'device',
    handler: (rc) => {
      const tag = tagReadService(deps.ctx)
      if (tag === undefined) throw new HttpError(404, 'read-state-unavailable', 'install dsh-tag to share read state')
      sendJson(rc.res, 200, { sessions: tag.reads(), serverTime: Date.now() })
    },
  })

  router.add({
    method: 'PATCH',
    pattern: '/read-state',
    auth: 'device',
    handler: async (rc) => {
      const tag = tagReadService(deps.ctx)
      if (tag === undefined) throw new HttpError(404, 'read-state-unavailable', 'install dsh-tag to share read state')
      const body = (rc.body ?? {}) as { sessions?: unknown }
      const sessions = parseReadState(body.sessions)
      if (sessions === undefined) {
        throw new HttpError(400, 'bad-read-state', 'sessions must be an object of {readAt, unread, at}')
      }
      sendJson(rc.res, 200, { sessions: tag.mergeReads(sessions), serverTime: Date.now() })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/model',
    auth: 'device',
    handler: async (rc) => {
      const catalog = await modelCatalog(deps.ctx)
      const resolved = await deps.ctx.sessionController.resolveAgent(rc.params.id!)
      if (!('agent' in resolved) || resolved.agent === undefined) {
        throw new HttpError(404, 'agent-not-found', 'the session has no live agent')
      }
      const agent = resolved.agent as unknown as Parameters<typeof currentSessionModel>[0]
      sendJson(rc.res, 200, { selection: currentSessionModel(agent, catalog.default) })
    },
  })

  router.add({
    method: 'PUT',
    pattern: '/sessions/:id/model',
    auth: 'device',
    handler: async (rc) => {
      const body = (rc.body ?? {}) as { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
      if (typeof body.provider !== 'string' || body.provider.length === 0 || typeof body.model !== 'string' || body.model.length === 0) {
        throw new HttpError(400, 'bad-model-selection', 'provider and model are required')
      }
      const selection: ModelSelection = {
        provider: body.provider,
        model: body.model,
        ...(typeof body.reasoningEffort === 'string' && body.reasoningEffort.length > 0 ? { reasoningEffort: body.reasoningEffort } : {}),
      }
      const resolved = await deps.ctx.sessionController.resolveAgent(rc.params.id!)
      if (!('agent' in resolved) || resolved.agent === undefined) {
        throw new HttpError(404, 'agent-not-found', 'the session has no live agent')
      }
      try {
        await selectSessionModel(deps.ctx, resolved.agent as unknown as Parameters<typeof selectSessionModel>[1], selection)
      } catch (error) {
        throw new HttpError(400, 'model-selection-rejected', error instanceof Error ? error.message : String(error))
      }
      sendJson(rc.res, 200, { selection })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/transcript',
    auth: 'device',
    handler: async (rc) => {
      const beforeSeq = numberParam(rc.query.get('beforeSeq'))
      const limit = numberParam(rc.query.get('limit'))
      const response: SessionTranscriptResponse = await deps.sessions.transcript(rc.params.id!, {
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        ...(limit === undefined ? {} : { maxMessages: limit }),
      }, rc.signal)
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/files',
    auth: 'device',
    handler: async (rc) => {
      const response = await listWorkspaceFiles(
        deps.ctx,
        rc.params.id!,
        rc.query.get('path') ?? '',
        rc.signal,
      )
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/file',
    auth: 'device',
    handler: async (rc) => {
      const path = rc.query.get('path')
      if (path === null || path.length === 0) throw new HttpError(400, 'empty-path', 'path is required')
      const offset = numberParam(rc.query.get('offset')) ?? 0
      const response = await readWorkspaceFile(deps.ctx, rc.params.id!, path, rc.signal, offset)
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/state',
    auth: 'device',
    handler: async (rc) => {
      const response: SessionStateResponse = await deps.sessions.state(rc.params.id!, rc.signal)
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/prompt',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { text?: unknown; requestId?: unknown; mode?: unknown; clientTimeZone?: unknown; attachments?: unknown } | undefined
      if (body === undefined || typeof body.text !== 'string') {
        throw new HttpError(400, 'bad-prompt', 'text is required')
      }
      const attachments = Array.isArray(body.attachments)
        ? body.attachments
            .filter((item): item is { receiptId: string } =>
              typeof item === 'object' && item !== null
              && typeof (item as { receiptId?: unknown }).receiptId === 'string'
              && (item as { receiptId: string }).receiptId.length > 0)
            .map(item => item.receiptId)
        : []
      if (body.text.trim().length === 0 && attachments.length === 0) {
        throw new HttpError(400, 'empty-prompt', 'text or at least one attachment is required')
      }
      const mode = body.mode === 'steer' ? 'steer' : 'queue'
      const requestId = typeof body.requestId === 'string' && body.requestId.length > 0 ? body.requestId : newId()
      const accepted = await deps.sessions.prompt(rc.params.id!, {
        requestId,
        text: body.text,
        mode,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(typeof body.clientTimeZone === 'string' ? { clientTimeZone: body.clientTimeZone } : {}),
      }, rc.signal)
      sendJson(rc.res, 202, accepted)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/uploads',
    auth: 'device',
    rawBody: true,
    // dsh enforces its own per-file and per-image budgets; this only bounds the wire read.
    maxBodyBytes: 30 * 1024 * 1024,
    handler: async (rc) => {
      const bytes = rc.body
      if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
        throw new HttpError(400, 'empty-upload', 'the request body must carry the file bytes')
      }
      const kind = rc.query.get('kind') === 'image' ? 'image' : 'file'
      const name = rc.query.get('name') ?? undefined
      const mediaType = rc.query.get('mediaType') ?? undefined
      try {
        const receipt = await uploadAttachment(deps.ctx, rc.params.id!, { kind, ...(name === undefined ? {} : { name }), ...(mediaType === undefined ? {} : { mediaType }), bytes })
        sendJson(rc.res, 201, receipt)
      } catch (error) {
        throw new HttpError(400, 'upload-rejected', error instanceof Error ? error.message : String(error))
      }
    },
  })

  router.add({
    method: 'PATCH',
    pattern: '/sessions/:id',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { title?: unknown } | undefined
      if (body === undefined || typeof body.title !== 'string' || body.title.trim().length === 0) {
        throw new HttpError(400, 'empty-title', 'title must be non-empty')
      }
      const renamed = await deps.sessions.rename(rc.params.id!, body.title)
      sendJson(rc.res, 200, renamed)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/fork',
    auth: 'device',
    handler: async (rc) => {
      const body = (rc.body ?? {}) as { atSeq?: unknown }
      if (body.atSeq !== undefined && (!Number.isSafeInteger(body.atSeq) || (body.atSeq as number) < 0)) {
        throw new HttpError(400, 'invalid-fork-seq', 'atSeq must be a non-negative safe integer')
      }
      const forked = await deps.sessions.fork(
        rc.params.id!,
        typeof body.atSeq === 'number' ? body.atSeq : undefined,
      )
      sendJson(rc.res, 201, forked)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/cancel',
    auth: 'device',
    handler: (rc) => {
      const accepted = deps.sessions.cancel(rc.params.id!)
      sendJson(rc.res, 202, accepted)
    },
  })

  router.add({
    method: 'PUT',
    pattern: '/sessions/:id/pin',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { pinned?: unknown } | undefined
      if (typeof body?.pinned !== 'boolean') {
        throw new HttpError(400, 'bad-pin', 'pinned must be true or false')
      }
      try {
        await setSessionPinned(deps.ctx, rc.params.id!, body.pinned)
        sendJson(rc.res, 200, { pinned: body.pinned })
      } catch (error) {
        throw new HttpError(409, 'session-pin-failed', shortError(error))
      }
    },
  })

  router.add({
    method: 'PUT',
    pattern: '/sessions/:id/archive',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { archived?: unknown; stopActivity?: unknown } | undefined
      if (typeof body?.archived !== 'boolean') {
        throw new HttpError(400, 'bad-archive', 'archived must be true or false')
      }
      try {
        await setSessionArchived(deps.ctx, rc.params.id!, body.archived, body.archived && body.stopActivity === true)
        sendJson(rc.res, 200, { archived: body.archived })
      } catch (error) {
        throw new HttpError(409, 'session-archive-failed', shortError(error))
      }
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/questions/:callId/answer',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { answers?: unknown } | undefined
      const answers = normalizeAnswers(body?.answers)
      const accepted = await deps.interactions.answerContinued(rc.params.id!, rc.params.callId!, { answers })
      if (!accepted) throw new HttpError(409, 'question-not-open', 'the question is not open in this session')
      sendJson(rc.res, 200, { accepted: true })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/events',
    auth: 'device',
    handler: async (rc) => {
      markStreaming(rc.res)
      startSse(rc.res)
      writeSse(rc.res, 'ready', { sessionId: rc.params.id!, time: Date.now() })
      const heartbeat = setInterval(() => writeSse(rc.res, 'heartbeat', { time: Date.now() }), 15_000)
      heartbeat.unref?.()
      // A client disconnect and a device revoke both end this follow stream.
      const abort = new AbortController()
      const onClientAbort = (): void => abort.abort()
      rc.signal.addEventListener('abort', onClientAbort)
      const untrack = deps.hub.trackDevice(rc.device!.deviceId, () => abort.abort())
      try {
        for await (const frame of deps.sessions.follow(rc.params.id!, abort.signal)) {
          if (abort.signal.aborted) break
          writeSse(rc.res, 'frame', frame)
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          writeSse(rc.res, 'error', { code: 'stream-failed', message: shortError(error) })
        }
      } finally {
        untrack()
        rc.signal.removeEventListener('abort', onClientAbort)
        clearInterval(heartbeat)
        if (!rc.res.writableEnded) rc.res.end()
      }
    },
  })

  deps.logger.info(
    `[dsh-hello] routes mounted at ${config.basePath} (protocol ${PROTOCOL_VERSION}, push ${config.push.provider})`,
  )
}

function assertLoopback(rc: RouteContext): void {
  const address = rc.clientAddress.replace(/^::ffff:/, '')
  if (address !== '127.0.0.1' && address !== '::1' && !address.startsWith('127.')) {
    throw new HttpError(403, 'loopback-only', 'this route is available only from the Host itself')
  }
}

function numberParam(value: string | null): number | undefined {
  if (value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return 'Mobile device'
  return value.trim().slice(0, 80)
}

function randomPairingToken(): string {
  // 32 random bytes rendered base64url, prefixed for recognisability.
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return `dshd_${Buffer.from(bytes).toString('base64url')}`
}

async function sendBinary(rc: RouteContext, file: { filename: string; size: number; contentType: string }): Promise<void> {
  const offset = numberParam(rc.query.get('offset')) ?? 0
  const limit = Math.min(Math.max(numberParam(rc.query.get('limit')) ?? 512 * 1024, 1), 2 * 1024 * 1024)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) {
    throw new HttpError(400, 'invalid-offset', 'offset must be a byte position inside the file')
  }
  const length = Math.min(limit, file.size - offset)
  const buffer = Buffer.alloc(length)
  const handle = await open(file.filename, 'r')
  let bytesRead = 0
  try {
    if (length > 0) ({ bytesRead } = await handle.read(buffer, 0, length, offset))
  } finally {
    await handle.close()
  }
  const chunk = buffer.subarray(0, bytesRead)
  sendJson(rc.res, 200, {
    path: rc.query.get('path') ?? '',
    size: file.size,
    offset,
    bytes: bytesRead,
    contentType: file.contentType,
    nextOffset: offset + bytesRead < file.size ? offset + bytesRead : undefined,
    dataBase64: chunk.toString('base64'),
  })
}
