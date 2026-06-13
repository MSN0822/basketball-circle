import { describe, expect, it } from 'vitest'
import { effectiveEventStatus, isVisibleToMembers } from '@/lib/event-visibility'

const NOW = new Date('2026-06-08T00:00:00.000Z').getTime()

describe('event visibility helpers', () => {
  it('keeps future drafts hidden from members', () => {
    const event = { status: 'draft' as const, publishes_at: '2026-06-09T00:00:00.000Z', closes_at: null }

    expect(isVisibleToMembers(event)).toBe(false)
    expect(effectiveEventStatus(event, NOW)).toBe('draft')
  })

  it('keeps due drafts hidden from members until an admin publishes them', () => {
    const event = { status: 'draft' as const, publishes_at: '2026-06-07T00:00:00.000Z', closes_at: null }

    expect(isVisibleToMembers(event)).toBe(false)
    expect(effectiveEventStatus(event, NOW)).toBe('draft')
  })

  it('treats past close times as closed for member-facing reads', () => {
    const event = { status: 'accepting' as const, publishes_at: null, closes_at: '2026-06-07T00:00:00.000Z' }

    expect(isVisibleToMembers(event)).toBe(true)
    expect(effectiveEventStatus(event, NOW)).toBe('closed')
  })
})
