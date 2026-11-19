import { HttpError, markStreaming, sendJson, sendNoContent, startSse, writeSse } from './http.js'
import type { HttpRouter } from './http.js'
import type { RouteDependencies } from './route-deps.js'
import type { TerminalEvent } from './terminal.js'

/** Retained terminals: list, create, live events, input, resize, close. */
export function registerTerminalRoutes(router: HttpRouter, deps: RouteDependencies): void {
  router.add({
    method: 'GET',
    pattern: '/sessions/:id/terminals',
    auth: 'device',
    handler: (rc) => {
      sendJson(rc.res, 200, { items: deps.terminals.list(rc.params.id!) })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/terminals',
    auth: 'device',
    handler: async (rc) => {
      const sessionId = rc.params.id!
      const body = rc.body as { cols?: unknown; rows?: unknown } | undefined
      const state = await deps.sessions.state(sessionId, rc.signal)
      const cwd = state.session.cwd
      if (typeof cwd !== 'string' || cwd.length === 0) {
        throw new HttpError(409, 'session-cwd-unknown', 'the session has no working directory yet')
      }
      const created = await deps.terminals.create(sessionId, cwd, {
        ...(typeof body?.cols === 'number' ? { cols: body.cols } : {}),
        ...(typeof body?.rows === 'number' ? { rows: body.rows } : {}),
      })
      sendJson(rc.res, 201, created)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/terminals/:terminalId/events',
    auth: 'device',
    handler: async (rc) => {
      const sessionId = rc.params.id!
      const terminalId = rc.params.terminalId!
      // Resolve before headers so a missing terminal is a JSON 404.
      const snapshot = deps.terminals.snapshot(sessionId, terminalId)
      markStreaming(rc.res)
      startSse(rc.res)
      const heartbeat = setInterval(() => writeSse(rc.res, 'heartbeat', { time: Date.now() }), 15_000)
      heartbeat.unref?.()
      let ready = false
      const pending: TerminalEvent[] = []
      let release: () => void = () => undefined
      const stopped = new Promise<void>(resolve => { release = resolve })
      const shutdown = (): void => {
        if (!rc.res.writableEnded) rc.res.end()
        release()
      }
      // Subscribe before the snapshot is sent, then flush anything that raced
      // in while the reconnect replay was being written.
      const unsubscribe = deps.terminals.subscribe(sessionId, terminalId, event => {
        if (!ready) {
          pending.push(event)
          return
        }
        writeSse(rc.res, event.type, event)
      })
      rc.signal.addEventListener('abort', shutdown)
      const untrack = deps.hub.trackDevice(rc.device!.deviceId, shutdown)
      writeSse(rc.res, 'ready', { ...snapshot, time: Date.now() })
      ready = true
      for (const event of pending.splice(0)) writeSse(rc.res, event.type, event)
      try {
        await stopped
      } finally {
        untrack()
        rc.signal.removeEventListener('abort', shutdown)
        unsubscribe()
        clearInterval(heartbeat)
        if (!rc.res.writableEnded) rc.res.end()
      }
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/terminals/:terminalId/input',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { data?: unknown } | undefined
      const data = body?.data
      if (typeof data !== 'string' || data.length === 0) {
        throw new HttpError(400, 'bad-input', 'data must be a non-empty string')
      }
      if (data.length > 65_536) throw new HttpError(413, 'input-too-large', 'terminal input is limited to 64 KiB')
      await deps.terminals.write(rc.params.id!, rc.params.terminalId!, data)
      sendJson(rc.res, 200, { accepted: true })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/terminals/:terminalId/resize',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { cols?: unknown; rows?: unknown } | undefined
      if (typeof body?.cols !== 'number' || typeof body?.rows !== 'number') {
        throw new HttpError(400, 'bad-size', 'cols and rows must be numbers')
      }
      const info = await deps.terminals.resize(rc.params.id!, rc.params.terminalId!, body.cols, body.rows)
      sendJson(rc.res, 200, info)
    },
  })

  router.add({
    method: 'DELETE',
    pattern: '/sessions/:id/terminals/:terminalId',
    auth: 'device',
    handler: async (rc) => {
      const closed = await deps.terminals.close(rc.params.id!, rc.params.terminalId!)
      if (!closed) throw new HttpError(404, 'terminal-not-found', 'no such terminal in this session')
      sendNoContent(rc.res)
    },
  })
}
