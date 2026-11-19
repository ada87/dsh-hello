import {
  agentPresetsAvailable,
  modelsAvailable,
  uploadsAvailable,
  workspaceRenameAvailable,
  workspacesAvailable,
} from './catalogs.js'
import type { HealthResponse, ServerFacts } from './protocol.js'
import { PROTOCOL_VERSION } from './protocol.js'
import { tagReadService } from './read-state.js'
import type { RouteDependencies } from './route-deps.js'
import type { RouteContext } from './http.js'
import { scheduleActionsAvailable, scheduleHistoryAvailable, schedulesAvailable } from './schedules.js'

export function serverFacts(deps: RouteDependencies, originOverride?: string | null): ServerFacts {
  const web = deps.ctx.webServer
  let fallback: string | null = null
  try {
    fallback = typeof web.getOrigin === 'function' ? web.getOrigin() : null
  } catch {
    fallback = null
  }
  const origin = originOverride ?? fallback
  return {
    name: 'dsh-hello',
    version: deps.pluginVersion,
    protocol: PROTOCOL_VERSION,
    dshVersion: deps.version.version,
    dshCompatible: deps.version.compatible,
    origin,
    protocolName: origin !== null && origin.startsWith('https://') ? 'https' : web.protocol === 'https:' ? 'https' : 'http',
    host: web.host ?? null,
    port: web.port ?? null,
  }
}

/** `scheme://authority` as the client reached this request, or null when unknown. */
export function requestOrigin(deps: RouteDependencies, rc: RouteContext): string | null {
  if (rc.authority.length === 0) return null
  const scheme = deps.ctx.webServer.protocol === 'https:' ? 'https' : 'http'
  return `${scheme}://${rc.authority}`
}

export function features(deps: RouteDependencies): HealthResponse['features'] {
  const target = deps.interactionTarget?.() ?? deps.config.interactionTarget
  return {
    approvals: target !== 'browser-only',
    questions: target !== 'browser-only',
    interactionTarget: target,
    presence: true,
    push: deps.push.isConfigured(),
    debugRoutes: deps.config.enableDebugRoutes,
    terminal: deps.terminals.available(),
    files: true,
    workspaces: workspacesAvailable(deps.ctx),
    workspaceRename: workspaceRenameAvailable(deps.ctx),
    archive: workspacesAvailable(deps.ctx),
    pin: workspacesAvailable(deps.ctx),
    agentPresets: agentPresetsAvailable(deps.ctx),
    models: modelsAvailable(deps.ctx),
    uploads: uploadsAvailable(deps.ctx),
    readState: tagReadService(deps.ctx) !== undefined,
    schedules: schedulesAvailable(deps.ctx),
    scheduleActions: scheduleActionsAvailable(deps.ctx),
    scheduleHistory: scheduleHistoryAvailable(deps.ctx),
    sessionEvents: 'sse',
    protocol: PROTOCOL_VERSION,
  }
}
