import { HttpError, markStreaming, sendJson, writeSse } from './http.js'
import type { HttpRouter } from './http.js'
import type { ApprovalDecision } from './protocol.js'
import type { RouteDependencies } from './route-deps.js'
import { normalizeAnswers } from './route-util.js'
import { features, requestOrigin, serverFacts } from './server-facts.js'
import { newId } from './util.js'

/**
 * The interaction surface the app polls: the global event stream, approvals,
 * questions, presence, and the authenticated debug injectors.
 */
export function registerInteractionRoutes(router: HttpRouter, deps: RouteDependencies): void {
  const { config } = deps

  router.add({
    method: 'GET',
    pattern: '/events',
    auth: 'device',
    handler: (rc) => {
      markStreaming(rc.res)
      const clientId = newId()
      deps.hub.add(clientId, rc.device!.deviceId, rc.res)
      writeSse(rc.res, 'hello', {
        server: serverFacts(deps, requestOrigin(deps, rc)),
        features: features(deps),
        pendingApprovals: deps.interactions.listApprovals(),
        pendingQuestions: deps.interactions.listQuestions(),
        time: Date.now(),
      })
      rc.req.on('close', () => {
        // `SseHub` removes the response on close; nothing else is owned here.
      })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/approvals',
    auth: 'device',
    handler: (rc) => {
      sendJson(rc.res, 200, { items: deps.interactions.listApprovals() })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/approvals/:id',
    auth: 'device',
    handler: (rc) => {
      const body = rc.body as { decision?: unknown } | undefined
      const decision = body?.decision
      if (decision !== 'allow' && decision !== 'deny' && decision !== 'always' && decision !== 'later') {
        throw new HttpError(400, 'bad-decision', 'decision must be allow, deny, always, or later')
      }
      const item = deps.interactions.decideApproval(rc.params.id!, decision as ApprovalDecision)
      if (item === undefined) throw new HttpError(404, 'approval-not-found', 'the approval is no longer pending')
      sendJson(rc.res, 200, { accepted: true, decision })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/presence',
    auth: 'device',
    handler: (rc) => {
      const body = rc.body as { foreground?: unknown } | undefined
      if (typeof body?.foreground !== 'boolean') {
        throw new HttpError(400, 'bad-presence', 'foreground must be a boolean')
      }
      const device = rc.device
      if (device === undefined) throw new HttpError(401, 'unauthenticated', 'a valid device token is required')
      deps.interactions.setPresence(device.deviceId, body.foreground)
      sendJson(rc.res, 200, { accepted: true })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/questions',
    auth: 'device',
    handler: (rc) => {
      sendJson(rc.res, 200, { items: deps.interactions.listQuestions() })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/questions/:id/answer',
    auth: 'device',
    handler: (rc) => {
      const body = rc.body as { answers?: unknown } | undefined
      const answers = normalizeAnswers(body?.answers)
      const answered = deps.interactions.answerQuestion(rc.params.id!, { answers })
      if (answered === undefined) throw new HttpError(404, 'question-not-found', 'the question is no longer pending')
      sendJson(rc.res, 200, { accepted: true })
    },
  })

  if (config.enableDebugRoutes) {
    router.add({
      method: 'POST',
      pattern: '/debug/approval',
      auth: 'device',
      handler: (rc) => {
        const body = (rc.body ?? {}) as {
          sessionId?: unknown
          toolName?: unknown
          reason?: unknown
          displayReason?: unknown
        }
        const item = deps.interactions.createDebugApproval({
          ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
          ...(typeof body.toolName === 'string' ? { toolName: body.toolName } : {}),
          ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
          ...(typeof body.displayReason === 'object' && body.displayReason !== null
            ? { displayReason: body.displayReason as { en: string; [locale: string]: string } }
            : {}),
        })
        sendJson(rc.res, 201, item)
      },
    })
    router.add({
      method: 'POST',
      pattern: '/debug/question',
      auth: 'device',
      handler: (rc) => {
        const body = (rc.body ?? {}) as { sessionId?: unknown; questions?: unknown }
        const item = deps.interactions.createDebugQuestion({
          ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
          ...(Array.isArray(body.questions) ? { questions: body.questions as never } : {}),
        })
        sendJson(rc.res, 201, item)
      },
    })
    deps.logger.warn('[dsh-hello] debug interaction routes are enabled')
  }
}
