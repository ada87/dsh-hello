import { HttpError, sendJson } from './http.js'
import type { HttpRouter } from './http.js'
import type { RouteDependencies } from './route-deps.js'
import {
  deleteSchedule,
  editSchedule,
  listSchedules,
  runSchedule,
  scheduleHistory,
  sessionScheduleMarks,
  viewSchedule,
} from './schedules.js'

/**
 * Automation tasks (dsh schedules) and the per-session delivery marks the app
 * uses to highlight "new result". Every write carries an optimistic-concurrency
 * `expectedUpdatedAt` where dsh exposes it.
 */
export function registerScheduleRoutes(router: HttpRouter, deps: RouteDependencies): void {
  router.add({
    method: 'GET',
    pattern: '/schedules',
    auth: 'device',
    handler: async (rc) => {
      const result = await listSchedules(deps.ctx, rc.signal)
      sendJson(rc.res, 200, result)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/schedules/marks',
    auth: 'device',
    handler: async (rc) => {
      sendJson(rc.res, 200, await sessionScheduleMarks(deps.ctx, rc.signal))
    },
  })

  router.add({
    method: 'GET',
    pattern: '/schedules/:id',
    auth: 'device',
    handler: async (rc) => {
      const result = await viewSchedule(deps.ctx, rc.params.id!)
      if (result === undefined) throw new HttpError(404, 'schedule-unavailable', 'the Host has no schedule service')
      const code = scheduleCode(result)
      if (code === 'schedule_not_found') throw new HttpError(404, 'schedule-not-found', 'the task no longer exists')
      sendJson(rc.res, 200, result)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/schedules/:id/history',
    auth: 'device',
    handler: async (rc) => {
      const rawLimit = rc.query.get('limit')
      const parsed = rawLimit === null ? 20 : Number(rawLimit)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        throw new HttpError(400, 'bad-limit', 'limit must be an integer from 1 to 100')
      }
      const before = rc.query.get('before') ?? undefined
      const result = await scheduleHistory(deps.ctx, rc.params.id!, parsed, before)
      if (result === undefined) throw new HttpError(404, 'schedule-unavailable', 'the Host has no schedule service')
      const code = scheduleCode(result)
      if (code === 'schedule_not_found') throw new HttpError(404, 'schedule-not-found', 'the task no longer exists')
      if (code === 'delivery_cursor_not_found') throw new HttpError(404, 'delivery-cursor-not-found', 'the history cursor is no longer valid')
      sendJson(rc.res, 200, result)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/schedules/:id/run',
    auth: 'device',
    handler: async (rc) => {
      const result = await runSchedule(deps.ctx, rc.params.id!, rc.signal)
      if (result === undefined) throw new HttpError(404, 'schedule-unavailable', 'the Host has no schedule service')
      const code = scheduleCode(result)
      if (code === 'schedule_not_found') throw new HttpError(404, 'schedule-not-found', 'the task no longer exists')
      if (code === 'schedule_execution_pending') {
        throw new HttpError(409, 'schedule-execution-pending', 'the task is already running or cooling down')
      }
      sendJson(rc.res, 200, result)
    },
  })

  router.add({
    method: 'PUT',
    pattern: '/schedules/:id',
    auth: 'device',
    handler: async (rc) => {
      const body = (rc.body ?? {}) as { active?: unknown; expectedUpdatedAt?: unknown }
      if (typeof body.active !== 'boolean') {
        throw new HttpError(400, 'bad-schedule-patch', 'active must be a boolean')
      }
      const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' || body.expectedUpdatedAt === null
        ? body.expectedUpdatedAt
        : undefined
      const result = await editSchedule(
        deps.ctx,
        rc.params.id!,
        { active: body.active },
        expectedUpdatedAt,
        rc.signal,
      )
      if (result === undefined) throw new HttpError(404, 'schedule-unavailable', 'the Host has no schedule service')
      const code = scheduleCode(result)
      if (code === 'schedule_not_found') throw new HttpError(404, 'schedule-not-found', 'the task no longer exists')
      if (code === 'schedule_conflict') throw new HttpError(409, 'schedule-conflict', 'the task changed on the Host')
      sendJson(rc.res, 200, result)
    },
  })

  router.add({
    method: 'DELETE',
    pattern: '/schedules/:id',
    auth: 'device',
    handler: async (rc) => {
      const body = (rc.body ?? {}) as { expectedUpdatedAt?: unknown }
      const fromBody = body.expectedUpdatedAt
      const fromQuery = rc.query.get('expectedUpdatedAt') ?? undefined
      const expectedUpdatedAt = typeof fromBody === 'string' || fromBody === null
        ? fromBody
        : fromQuery
      const result = await deleteSchedule(deps.ctx, rc.params.id!, expectedUpdatedAt, rc.signal)
      if (result === undefined) throw new HttpError(404, 'schedule-unavailable', 'the Host has no schedule service')
      const code = scheduleCode(result)
      if (code === 'schedule_not_found') throw new HttpError(404, 'schedule-not-found', 'the task no longer exists')
      if (code === 'schedule_conflict') throw new HttpError(409, 'schedule-conflict', 'the task changed on the Host')
      sendJson(rc.res, 200, result)
    },
  })
}

function scheduleCode(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const code = (result as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}
