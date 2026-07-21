import { describe, expect, it } from 'vitest'
import { mockSupabaseFrom } from './helpers/mock-supabase'
import { getRosterParticipants, getVisibleEventById, getVisibleEventsForMembers } from '@/lib/event-queries'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    title: 'Practice',
    event_date: '2026-07-01T10:00:00.000Z',
    event_end_date: '2026-07-01T12:00:00.000Z',
    location: 'Gym',
    location_url: null,
    publishes_at: null,
    max_participants: 35,
    threshold: 30,
    status: 'accepting',
    is_manual_close: false,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

// DB 障害を「イベント0件」「404」に潰さないことが本質。error は必ず throw する。
describe('getVisibleEventsForMembers', () => {
  it('Supabase の error を握り潰さず throw する', async () => {
    const supabase = mockSupabaseFrom({ selectOrderResult: { data: null, error: { message: 'connection refused' } } })

    await expect(getVisibleEventsForMembers(supabase.client)).rejects.toThrow('connection refused')
  })

  it('会員に非公開のイベント（draft / archived）を除外する', async () => {
    const supabase = mockSupabaseFrom({
      selectOrderResult: {
        data: [
          event({ id: 'a', status: 'accepting' }),
          event({ id: 'b', status: 'draft' }),
          event({ id: 'c', status: 'closed' }),
          event({ id: 'd', status: 'archived' }),
        ],
        error: null,
      },
    })

    const events = await getVisibleEventsForMembers(supabase.client)

    expect(events.map(e => e.id)).toEqual(['a', 'c'])
  })

  it('データが null（0件）なら空配列を返す', async () => {
    const supabase = mockSupabaseFrom({ selectOrderResult: { data: null, error: null } })

    await expect(getVisibleEventsForMembers(supabase.client)).resolves.toEqual([])
  })

  it('開催日の昇順で取得する', async () => {
    const supabase = mockSupabaseFrom({ selectOrderResult: { data: [], error: null } })

    await getVisibleEventsForMembers(supabase.client)

    expect(supabase.spies.mockFrom).toHaveBeenCalledWith('events')
    expect(supabase.spies.selectOrder).toHaveBeenCalledWith('event_date', { ascending: true })
  })
})

describe('getVisibleEventById', () => {
  it('Supabase の error を握り潰さず throw する（404 に化けさせない）', async () => {
    const supabase = mockSupabaseFrom({ selectMaybeSingleResult: { data: null, error: { message: 'timeout' } } })

    await expect(getVisibleEventById(supabase.client, EVENT_ID)).rejects.toThrow('timeout')
  })

  it('該当行が無ければ null を返す', async () => {
    const supabase = mockSupabaseFrom({ selectMaybeSingleResult: { data: null, error: null } })

    await expect(getVisibleEventById(supabase.client, EVENT_ID)).resolves.toBeNull()
  })

  it('会員に非公開のイベントは null を返す', async () => {
    const supabase = mockSupabaseFrom({ selectMaybeSingleResult: { data: event({ status: 'draft' }), error: null } })

    await expect(getVisibleEventById(supabase.client, EVENT_ID)).resolves.toBeNull()
  })

  it('公開中のイベントを実効ステータス付きで返す', async () => {
    const supabase = mockSupabaseFrom({ selectMaybeSingleResult: { data: event({ status: 'closed' }), error: null } })

    const found = await getVisibleEventById(supabase.client, EVENT_ID)

    expect(found).toMatchObject({ id: EVENT_ID, status: 'closed' })
    expect(supabase.spies.selectEq).toHaveBeenCalledWith('id', EVENT_ID)
  })
})

describe('getRosterParticipants', () => {
  it('Supabase の error を握り潰さず throw する（参加者0名に化けさせない）', async () => {
    const supabase = mockSupabaseFrom({ selectOrderResult: { data: null, error: { message: 'view missing' } } })

    await expect(getRosterParticipants(supabase.client, EVENT_ID)).rejects.toThrow('view missing')
  })

  it('データが null なら空配列を返す', async () => {
    const supabase = mockSupabaseFrom({ selectOrderResult: { data: null, error: null } })

    await expect(getRosterParticipants(supabase.client, EVENT_ID)).resolves.toEqual([])
  })

  it('公開ビューからキャンセル済みを除外し、枠番順で取得する', async () => {
    const supabase = mockSupabaseFrom({ selectOrderResult: { data: [], error: null } })

    await getRosterParticipants(supabase.client, EVENT_ID)

    expect(supabase.spies.mockFrom).toHaveBeenCalledWith('participants_public')
    expect(supabase.spies.selectEq).toHaveBeenCalledWith('event_id', EVENT_ID)
    expect(supabase.spies.selectNeq).toHaveBeenCalledWith('status', 'cancelled')
    expect(supabase.spies.selectOrder).toHaveBeenCalledWith('slot_number', { ascending: true })
  })

  it('user_code を含まない公開列だけを取得する', async () => {
    const supabase = mockSupabaseFrom({ selectOrderResult: { data: [], error: null } })

    await getRosterParticipants(supabase.client, EVENT_ID)

    const requestedColumns = supabase.spies.select.mock.calls[0][0] as string
    expect(requestedColumns).not.toContain('user_code')
    expect(requestedColumns).not.toContain('member_id')
  })
})
