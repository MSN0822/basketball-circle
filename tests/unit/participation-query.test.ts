import { describe, expect, it } from 'vitest'
import {
  getMyParticipationAndGuests,
  getMyParticipations,
  guestDisplayCode,
  toPublicParticipant,
} from '@/lib/participation-query'
import { mockSupabaseFrom } from './helpers/mock-supabase'

const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'

describe('toPublicParticipant', () => {
  it('returns null for null or undefined input', () => {
    expect(toPublicParticipant(null)).toBeNull()
    expect(toPublicParticipant(undefined)).toBeNull()
  })

  it('strips user_code, member_id, and events from the result', () => {
    const result = toPublicParticipant({
      id: 'p1',
      event_id: EVENT_ID,
      name: 'Name',
      user_code: '12345',
      member_id: MEMBER_ID,
      status: 'active',
      slot_number: null,
      created_at: 't0',
      events: { id: EVENT_ID, status: 'accepting', publishes_at: null },
    })

    expect(result).not.toHaveProperty('user_code')
    expect(result).not.toHaveProperty('member_id')
    expect(result).not.toHaveProperty('events')
  })

  it('sets display_code to null for non-guest participants', () => {
    const result = toPublicParticipant({
      id: 'p1', event_id: EVENT_ID, name: 'Name', user_code: '12345', member_id: null,
      status: 'active', slot_number: null, created_at: 't0',
    })

    expect(result?.display_code).toBeNull()
  })

  it('derives display_code from a guest user_code', () => {
    const result = toPublicParticipant({
      id: 'p1', event_id: EVENT_ID, name: 'Guest', user_code: `guest:${MEMBER_ID}:54321`, member_id: null,
      status: 'active', slot_number: null, created_at: 't0',
    })

    expect(result?.display_code).toBe('54321')
  })
})

describe('guestDisplayCode', () => {
  it('returns null for non-guest codes', () => {
    expect(guestDisplayCode('12345')).toBeNull()
  })

  it('extracts the trailing segment for guest codes', () => {
    expect(guestDisplayCode(`guest:${MEMBER_ID}:54321`)).toBe('54321')
  })

  it('returns an empty string for a malformed guest code with no trailing segment', () => {
    expect(guestDisplayCode('guest:')).toBe('')
  })
})

describe('getMyParticipations', () => {
  it('keeps rows whose event is visible to members and drops draft/archived rows', async () => {
    const supabase = mockSupabaseFrom({
      selectOrderResult: {
        data: [
          { id: '1', event_id: 'e1', name: 'A', user_code: '11111', member_id: MEMBER_ID, status: 'active', slot_number: null, created_at: 't1', events: { id: 'e1', status: 'accepting', publishes_at: null } },
          { id: '2', event_id: 'e2', name: 'B', user_code: '22222', member_id: MEMBER_ID, status: 'active', slot_number: null, created_at: 't2', events: { id: 'e2', status: 'closed', publishes_at: null } },
          { id: '3', event_id: 'e3', name: 'C', user_code: '33333', member_id: MEMBER_ID, status: 'active', slot_number: null, created_at: 't3', events: { id: 'e3', status: 'draft', publishes_at: null } },
          { id: '4', event_id: 'e4', name: 'D', user_code: '44444', member_id: MEMBER_ID, status: 'active', slot_number: null, created_at: 't4', events: { id: 'e4', status: 'archived', publishes_at: null } },
        ],
        error: null,
      },
    })

    const result = await getMyParticipations(supabase.client, MEMBER_ID)

    expect(result.map(p => p.id)).toEqual(['1', '2'])
    expect(supabase.spies.selectEq).toHaveBeenCalledWith('member_id', MEMBER_ID)
    expect(supabase.spies.selectNeq).toHaveBeenCalledWith('status', 'cancelled')
  })

  it('throws when the query returns an error', async () => {
    const supabase = mockSupabaseFrom({
      selectOrderResult: { data: null, error: { message: 'connection terminated' } },
    })

    await expect(getMyParticipations(supabase.client, MEMBER_ID)).rejects.toThrow('connection terminated')
  })
})

describe('getMyParticipationAndGuests', () => {
  it('returns the public participation and public guests filtered by guest user_code prefix', async () => {
    const participation = {
      id: 'p1', event_id: EVENT_ID, name: 'Me', user_code: '12345', member_id: MEMBER_ID,
      status: 'active', slot_number: null, created_at: 't0',
    }
    const guest = {
      id: 'g1', event_id: EVENT_ID, name: 'Guest', user_code: `guest:${MEMBER_ID}:54321`, member_id: null,
      status: 'active', slot_number: null, created_at: 't1',
    }
    const supabase = mockSupabaseFrom({
      selectMaybeSingleResult: { data: participation, error: null },
      selectOrderResult: { data: [guest], error: null },
    })

    const result = await getMyParticipationAndGuests(supabase.client, EVENT_ID, MEMBER_ID)

    expect(result.participation).not.toHaveProperty('user_code')
    expect(result.participation?.display_code).toBeNull()
    expect(result.guests).toHaveLength(1)
    expect(result.guests[0]).not.toHaveProperty('user_code')
    expect(result.guests[0].display_code).toBe('54321')
    expect(supabase.spies.selectLike).toHaveBeenCalledWith('user_code', `guest:${MEMBER_ID}:%`)
  })

  it('returns a null participation when none exists', async () => {
    const supabase = mockSupabaseFrom({
      selectMaybeSingleResult: { data: null, error: null },
      selectOrderResult: { data: [], error: null },
    })

    const result = await getMyParticipationAndGuests(supabase.client, EVENT_ID, MEMBER_ID)

    expect(result.participation).toBeNull()
    expect(result.guests).toEqual([])
  })

  it('throws with the participation error message when the participation query fails', async () => {
    const supabase = mockSupabaseFrom({
      selectMaybeSingleResult: { data: null, error: { message: 'participation failed' } },
      selectOrderResult: { data: [], error: null },
    })

    await expect(getMyParticipationAndGuests(supabase.client, EVENT_ID, MEMBER_ID)).rejects.toThrow('participation failed')
  })

  it('throws with the guests error message when only the guests query fails', async () => {
    const supabase = mockSupabaseFrom({
      selectMaybeSingleResult: { data: null, error: null },
      selectOrderResult: { data: null, error: { message: 'guests failed' } },
    })

    await expect(getMyParticipationAndGuests(supabase.client, EVENT_ID, MEMBER_ID)).rejects.toThrow('guests failed')
  })
})
