import type { EventStatus } from '@/lib/supabase'

type EventVisibilityFields = {
  status: EventStatus
  publishes_at: string | null
  closes_at: string | null
}

function isPast(iso: string | null, nowMs: number): boolean {
  return Boolean(iso && new Date(iso).getTime() <= nowMs)
}

export function isVisibleToMembers(event: EventVisibilityFields): boolean {
  return event.status === 'accepting' || event.status === 'closed'
}

export function effectiveEventStatus(event: EventVisibilityFields, nowMs = Date.now()): EventStatus {
  if (event.status === 'accepting' && isPast(event.closes_at, nowMs)) return 'closed'
  return event.status
}

export function withEffectiveEventStatus<T extends EventVisibilityFields>(event: T, nowMs = Date.now()): T {
  return {
    ...event,
    status: effectiveEventStatus(event, nowMs),
  }
}
