import { describe, expect, it } from 'vitest'
import { effectiveEventStatus, isVisibleToMembers } from '@/lib/event-visibility'

describe('event visibility helpers', () => {
  it('keeps future drafts hidden from members', () => {
    const event = { status: 'draft' as const, publishes_at: '2026-06-09T00:00:00.000Z' }

    expect(isVisibleToMembers(event)).toBe(false)
    expect(effectiveEventStatus(event)).toBe('draft')
  })

  it('keeps due drafts hidden until the publish job promotes them', () => {
    const event = { status: 'draft' as const, publishes_at: '2026-06-07T00:00:00.000Z' }

    expect(isVisibleToMembers(event)).toBe(false)
    expect(effectiveEventStatus(event)).toBe('draft')
  })

  it('hides archived events from member-facing reads', () => {
    const event = { status: 'archived' as const, publishes_at: null }

    expect(isVisibleToMembers(event)).toBe(false)
    expect(effectiveEventStatus(event)).toBe('archived')
  })
})
