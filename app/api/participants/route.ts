import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Participant } from '@/lib/supabase'
import { generateUserCode } from '@/lib/user-code'
import { getAuthenticatedMember } from '@/lib/api-auth'
import { resolveServerSupabase } from '@/lib/route-supabase'
import { enforceRateLimit } from '@/lib/rate-limit'
import { JOIN_LIMIT } from '@/lib/api-rate-limits'
import { isValidUuid } from '@/lib/validators'
import { effectiveEventStatus, isVisibleToMembers } from '@/lib/event-visibility'
import { publishDueDraftEvents } from '@/lib/event-publishing'
import { getMyParticipationAndGuests, getMyParticipations, toPublicParticipant } from '@/lib/participation-query'

const MAX_PARTICIPANT_NAME_LENGTH = 100

type JoinEventResult = {
  error?: string
  status?: number
  participant_status?: Participant['status']
  participant?: Participant
}

type VisibleEvent = {
  id: string
  status: 'accepting' | 'closed' | 'draft' | 'archived'
  publishes_at: string | null
}

async function getVisibleEvent(supabase: SupabaseClient, eventId: string): Promise<VisibleEvent | null> {
  await publishDueDraftEvents(supabase)

  const { data, error } = await supabase
    .from('events')
    .select('id,status,publishes_at')
    .eq('id', eventId)
    .maybeSingle<VisibleEvent>()

  if (error) throw error
  if (!data || !isVisibleToMembers(data)) return null

  const nextStatus = effectiveEventStatus(data)
  return { ...data, status: nextStatus }
}

export async function GET(req: NextRequest) {
  const resolved = resolveServerSupabase()
  if (resolved.response) return resolved.response
  const supabase = resolved.supabase

  const eventId = req.nextUrl.searchParams.get('event_id')
  const requestedMemberId = req.nextUrl.searchParams.get('member_id')
  if (eventId && !isValidUuid(eventId)) {
    return NextResponse.json({ error: 'event_id の形式が正しくありません' }, { status: 400 })
  }

  if (eventId && !requestedMemberId) {
    const auth = await getAuthenticatedMember(req, null)
    if (!auth.member) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    try {
      const visibleEvent = await getVisibleEvent(supabase, eventId)
      if (!visibleEvent) {
        return NextResponse.json({ error: 'イベントが見つかりません' }, { status: 404 })
      }

      const { data, error } = await supabase
        .from('participants_public')
        .select('id,event_id,name,status,slot_number,created_at,display_code')
        .eq('event_id', eventId)
        .neq('status', 'cancelled')
        .order('slot_number', { ascending: true })

      if (error) throw error
      return NextResponse.json({ participants: data ?? [] })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '参加者情報の取得に失敗しました' },
        { status: 500 },
      )
    }
  }

  const auth = await getAuthenticatedMember(req, requestedMemberId)
  if (!auth.member) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const canonicalMemberId = auth.member.id

  try {
    await publishDueDraftEvents(supabase)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '予約公開の反映に失敗しました' },
      { status: 500 },
    )
  }

  if (!eventId) {
    try {
      const participations = await getMyParticipations(supabase, canonicalMemberId)
      return NextResponse.json({ participations })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '参加情報の取得に失敗しました' },
        { status: 500 },
      )
    }
  }

  try {
    const visibleEvent = await getVisibleEvent(supabase, eventId)
    if (!visibleEvent) {
      return NextResponse.json({ error: 'イベントが見つかりません' }, { status: 404 })
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'イベント情報の取得に失敗しました' },
      { status: 500 },
    )
  }

  try {
    const mine = await getMyParticipationAndGuests(supabase, eventId, canonicalMemberId)
    return NextResponse.json(mine)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '参加情報の取得に失敗しました' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const resolved = resolveServerSupabase()
  if (resolved.response) return resolved.response
  const supabase = resolved.supabase

  const { event_id, name, member_id, guest } = await req.json()
  const auth = await getAuthenticatedMember(req, member_id ?? null)
  if (!auth.member) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const canonicalMemberId = auth.member.id

  // 認証で解決された会員IDをキーにする。認証前に数えると、第三者が他人の会員IDを
  // 投げるだけで正規会員をロックできてしまうため、必ずこの位置で呼ぶこと。
  const rateLimited = await enforceRateLimit(`join:member:${canonicalMemberId}`, JOIN_LIMIT)
  if (rateLimited) return rateLimited

  const trimmedName = (guest ? name : auth.member.name)?.trim()

  if (!event_id || !trimmedName) {
    return NextResponse.json({ error: '名前とイベントIDは必須です' }, { status: 400 })
  }
  if (trimmedName.length > MAX_PARTICIPANT_NAME_LENGTH) {
    return NextResponse.json(
      { error: `name は ${MAX_PARTICIPANT_NAME_LENGTH} 文字以内で入力してください` },
      { status: 400 },
    )
  }
  if (!isValidUuid(event_id)) {
    return NextResponse.json({ error: 'event_id の形式が正しくありません' }, { status: 400 })
  }

  try {
    const visibleEvent = await getVisibleEvent(supabase, event_id)
    if (!visibleEvent) {
      return NextResponse.json({ error: 'イベントが見つかりません' }, { status: 404 })
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'イベント情報の取得に失敗しました' },
      { status: 500 },
    )
  }

  const temporaryCode = generateUserCode()
  const userCode = guest ? `guest:${canonicalMemberId}:${temporaryCode}` : temporaryCode

  const { data, error } = await supabase.rpc('join_event', {
    p_event_id: event_id,
    p_name: trimmedName,
    p_user_code: userCode,
    p_member_id: canonicalMemberId,
    p_is_guest: Boolean(guest),
  })

  if (error) {
    const rpcMissing = error.code === 'PGRST202' || Boolean(error.message?.includes('join_event'))
    const message = rpcMissing
      ? '参加申請処理が未設定です。管理者に連絡してください'
      : error.message
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const result = data as JoinEventResult | null
  if (!result) {
    return NextResponse.json({ error: '参加申請に失敗しました' }, { status: 500 })
  }

  if (result.error) {
    return NextResponse.json(
      { error: result.error, status: result.participant_status },
      { status: result.status ?? 400 }
    )
  }

  return NextResponse.json({
    participant: toPublicParticipant(result.participant),
    waitlist: false,
    temporary_code: temporaryCode,
  })
}
