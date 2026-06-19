import type { EventStatus } from '@/lib/supabase'

type EventVisibilityFields = {
  status: EventStatus
  publishes_at: string | null
}

export function isVisibleToMembers(event: EventVisibilityFields): boolean {
  return event.status === 'accepting' || event.status === 'closed'
}

export function effectiveEventStatus(event: EventVisibilityFields): EventStatus {
  return event.status
}

export function withEffectiveEventStatus<T extends EventVisibilityFields>(event: T): T {
  return {
    ...event,
    status: effectiveEventStatus(event),
  }
}
