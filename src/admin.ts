import type { Config } from './config.js'
import type { DeviceStore } from './devices.js'
import type { HostContext } from './host.js'
import { HttpError, sendJson } from './http.js'
import type { HttpRouter, RouteContext } from './http.js'
import type { PairingManager } from './pairing.js'
import { renderQrSvg } from './qr.js'
import type { SseHub } from './streams.js'

/**
 * The admin page's BFF: pairing code, lock, interaction policy and the paired
 * device list. Every route is `public` because the page authenticates with the
 * Host's own browser session; `adminAuthorized` accepts that session (via
 * `connection.admit`) or a loopback caller.
 */
export interface AdminDependencies {
  config: Config
  ctx: HostContext
  pairing: PairingManager
  devices: DeviceStore
  hub: SseHub
  interactionTarget?: () => Config['interactionTarget']
  saveInteractionTarget?: (target: Config['interactionTarget']) => Promise<void>
  /** `scheme://authority` of the request, for origins the page can reach. */
  requestOrigin(rc: RouteContext): string | null
}

export function registerAdminRoutes(router: HttpRouter, deps: AdminDependencies): void {
  const originOf = (rc: RouteContext): string => requestBase(rc) ?? deps.requestOrigin(rc) ?? ''

  router.add({
    method: 'GET',
    pattern: '/admin/data',
    auth: 'public',
    handler: async (rc) => {
      if (!adminAuthorized(deps, rc)) throw unauthorized()
      sendJson(rc.res, 200, await adminData(deps, originOf(rc)))
    },
  })

  router.add({
    method: 'POST',
    pattern: '/admin/pair-code',
    auth: 'public',
    handler: async (rc) => {
      if (!adminAuthorized(deps, rc)) throw unauthorized()
      const body = (rc.body ?? {}) as { action?: unknown; code?: unknown }
      try {
        if (body.action === 'fixed') {
          if (typeof body.code !== 'string') throw new HttpError(400, 'bad-code', 'code is required')
          await deps.pairing.setFixedCode(body.code)
        } else if (body.action === 'auto' || body.action === 'rotate') {
          if (body.action === 'auto') await deps.pairing.setFixedCode(null)
          else deps.pairing.rotate()
        } else {
          throw new HttpError(400, 'bad-action', 'action must be rotate, fixed, or auto')
        }
      } catch (error) {
        if (error instanceof HttpError) throw error
        throw new HttpError(400, 'bad-code', error instanceof Error ? error.message : String(error))
      }
      sendJson(rc.res, 200, await adminData(deps, originOf(rc)))
    },
  })

  router.add({
    method: 'POST',
    pattern: '/admin/interaction',
    auth: 'public',
    handler: async (rc) => {
      if (!adminAuthorized(deps, rc)) throw unauthorized()
      const body = (rc.body ?? {}) as { target?: unknown }
      const target = body.target
      if (target !== 'phone-first' && target !== 'browser-first' && target !== 'browser-only') {
        throw new HttpError(400, 'bad-target', 'target must be phone-first, browser-first, or browser-only')
      }
      if (deps.saveInteractionTarget === undefined) {
        throw new HttpError(503, 'interaction-unavailable', 'this Host cannot change the interaction policy')
      }
      await deps.saveInteractionTarget(target)
      sendJson(rc.res, 200, await adminData(deps, originOf(rc)))
    },
  })

  router.add({
    method: 'POST',
    pattern: '/admin/lock',
    auth: 'public',
    handler: async (rc) => {
      if (!adminAuthorized(deps, rc)) throw unauthorized()
      const body = (rc.body ?? {}) as { locked?: unknown }
      if (typeof body.locked !== 'boolean') throw new HttpError(400, 'bad-lock', 'locked must be true or false')
      await deps.pairing.setLocked(body.locked)
      sendJson(rc.res, 200, await adminData(deps, originOf(rc)))
    },
  })

  router.add({
    method: 'DELETE',
    pattern: '/admin/devices/:id',
    auth: 'public',
    handler: async (rc) => {
      if (!adminAuthorized(deps, rc)) throw unauthorized()
      const removed = await deps.devices.revoke(rc.params.id!)
      if (!removed) throw new HttpError(404, 'device-not-found', 'no such device')
      deps.hub.closeDevice(rc.params.id!)
      sendJson(rc.res, 200, await adminData(deps, originOf(rc)))
    },
  })

  router.add({
    method: 'PUT',
    pattern: '/admin/devices/:id',
    auth: 'public',
    handler: async (rc) => {
      if (!adminAuthorized(deps, rc)) throw unauthorized()
      const body = (rc.body ?? {}) as { name?: unknown }
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      if (name.length === 0) throw new HttpError(400, 'bad-device-name', 'a non-empty device name is required')
      const renamed = await deps.devices.rename(rc.params.id!, name)
      if (!renamed) throw new HttpError(404, 'device-not-found', 'no such device')
      sendJson(rc.res, 200, await adminData(deps, originOf(rc)))
    },
  })
}

function unauthorized(): HttpError {
  return new HttpError(401, 'admin-unauthorized', 'open this page from an authenticated dsh browser')
}

async function adminData(deps: AdminDependencies, origin: string): Promise<Record<string, unknown>> {
  const view = deps.pairing.current()
  const payload = JSON.stringify({ v: 1, url: `${origin}${deps.config.basePath}`, code: view.code })
  const { svg: qrSvg, error: qrError } = await renderQrSvg(payload)
  return {
    code: view.code,
    formatted: view.formatted,
    fixed: view.fixed,
    locked: deps.pairing.isLocked(),
    interactionTarget: deps.interactionTarget?.() ?? deps.config.interactionTarget,
    expiresAt: view.fixed ? null : view.expiresAt,
    origin,
    basePath: deps.config.basePath,
    qrSvg,
    qrError,
    time: Date.now(),
    devices: deps.devices.list().map(device => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: device.platform,
      appVersion: device.appVersion,
      authorities: device.authorities,
      pairedAt: device.pairedAt,
      lastSeenAt: device.lastSeenAt,
      push: device.push !== undefined,
    })),
  }
}

function adminAuthorized(deps: AdminDependencies, rc: RouteContext): boolean {
  const connection = deps.ctx.get('connection') as
    | { admit(request: { headers: Record<string, string | string[] | undefined> }): { peer?: unknown; rejection?: number } }
    | undefined
  if (connection !== undefined && typeof connection.admit === 'function') {
    try {
      const admission = connection.admit({ headers: rc.req.headers })
      if (admission.peer !== undefined) return true
    } catch {
      // Fall through to the loopback check.
    }
  }
  return rc.clientAddress === '127.0.0.1' || rc.clientAddress === '::1' || rc.clientAddress.startsWith('127.')
}

/**
 * The admin page sends the base directory it was loaded from (`new URL('.',
 * location.href)`). It is the URL the user is actually using, so the Settings
 * QR follows the public URL without any Host-side public-URL configuration.
 * A loopback page yields a loopback QR; the phone can edit the address.
 */
function requestBase(rc: RouteContext): string | null {
  const value = rc.query.get('base')
  if (value === null || value.length === 0 || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}
