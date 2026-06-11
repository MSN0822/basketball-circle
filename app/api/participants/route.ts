import { NextRequest, NextResponse } from 'next/server'
import { generateUserCode, Participant } from '@/lib/supabase'
import { getAuthenticatedMember } from '@/lib/api-auth'
import { getServerSupabase } from '@/lib/supabase-server'
import { isValidUuid } from '@/lib/validators'
import { effectiveEventStatus, isVisibleToMembers } from '@/lib/event-visibility'
import { getMyParticipationAndGuests, toPublicParticipant } from '@/lib/participation-query'

const supabase = getServerSupabase()
const MAX_PARTICIPANT_NAME_LENGTH = 100

type JoinEventResult = {
  error?: string
  status?: number
  participant_status?: Participant['status']
  participant?: Participant
}

type VisibleEvent = {
  id: string
  status: 'accepting' | 'closed' | 'draft'
  publishes_at: string | null
  closes_at: string | null
}

type ParticipantWithEvent = Participant & {
  events?: VisibleEvent | null
}

async function getVisibleEvent(
  eventId: string,
  options: { persistEffectiveStatus?: boolean } = {},
): Promise<VisibleEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('id,status,publishes_at,closes_at')
    .eq('id', eventId)
    .maybeSingle<VisibleEvent>()

  if (error) throw error
  if (!data || !isVisibleToMembers(data)) return null

  const nextStatus = effectiveEventStatus(data)
  if (options.persistEffectiveStatus && nextStatus !== data.status) {
    const { error: updateError } = await supabase
      .from('events')
      .update({ status: nextStatus })
      .eq('id', eventId)
      .eq('status', data.status)
    if (updateError) throw updateError
    return { ...data, status: nextStatus }
  }

  return { ...data, status: nextStatus }
}

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id')
  const requestedMemberId = req.nextUrl.searchParams.get('member_id')
  if (eventId && !isValidUuid(eventId)) {
    return NextResponse.json({ error: 'event_id の形式が正しくありません' }, { status: 400 })
  }

  const auth = await getAuthenticatedMember(req, requestedMemberId)
  if (!auth.member) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const canonicalMemberId = auth.member.id

  if (!eventId) {
    const { data, error } = await supabase
      .from('participants')
      .select('*, events!inner(id,status,publishes_at,closes_at)')
      .eq('member_id', canonicalMemberId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      participations: ((data as ParticipantWithEvent[] | null) ?? [])
        .filter(row => row.events && isVisibleToMembers(row.events))
        .map(toPublicParticipant)
        .filter(Boolean),
    })
  }

  try {
    const visibleEvent = await getVisibleEvent(eventId)
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
  const { event_id, name, member_id, guest } = await req.json()
  const auth = await getAuthenticatedMember(req, member_id ?? null)
  if (!auth.member) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const canonicalMemberId = auth.member.id
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
    const visibleEvent = await getVisibleEvent(event_id, { persistEffectiveStatus: true })
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
