import type { EventStatus } from '@/lib/supabase'

type EventVisibilityFields = {
  status: EventStatus
  publishes_at: string | null
  closes_at: string | null
}

function isPast(iso: string | null, nowMs: number): boolean {
  return Boolean(iso && new Date(iso).getTime() <= nowMs)
}

export function isPublishDue(event: EventVisibilityFields, nowMs = Date.now()): boolean {
  return event.status === 'draft' && isPast(event.publishes_at, nowMs)
}

export function isVisibleToMembers(event: EventVisibilityFields, nowMs = Date.now()): boolean {
  return event.status !== 'draft' || isPublishDue(event, nowMs)
}

export function effectiveEventStatus(event: EventVisibilityFields, nowMs = Date.now()): EventStatus {
  const publishedStatus: EventStatus = isPublishDue(event, nowMs) ? 'accepting' : event.status
  if (publishedStatus === 'accepting' && isPast(event.closes_at, nowMs)) return 'closed'
  return publishedStatus
}

export function withEffectiveEventStatus<T extends EventVisibilityFields>(event: T, nowMs = Date.now()): T {
  return {
    ...event,
    status: effectiveEventStatus(event, nowMs),
  }
}
