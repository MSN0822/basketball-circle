import { describe, expect, it } from 'vitest'
import { effectiveEventStatus, isVisibleToMembers, withEffectiveEventStatus } from '@/lib/event-visibility'

describe('event visibility helpers', () => {
  it('shows accepting events to members', () => {
    const event = { status: 'accepting' as const, publishes_at: null }

    expect(isVisibleToMembers(event)).toBe(true)
    expect(effectiveEventStatus(event)).toBe('accepting')
  })

  it('shows closed events to members', () => {
    const event = { status: 'closed' as const, publishes_at: null }

    expect(isVisibleToMembers(event)).toBe(true)
    expect(effectiveEventStatus(event)).toBe('closed')
  })

  it('passes the status through unchanged via withEffectiveEventStatus', () => {
    const event = { id: 'evt-1', status: 'accepting' as const, publishes_at: null }

    expect(withEffectiveEventStatus(event)).toEqual(event)
  })

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
