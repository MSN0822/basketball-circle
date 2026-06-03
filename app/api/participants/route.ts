import { NextRequest, NextResponse } from 'next/server'
import { generateUserCode, Participant, PublicParticipant } from '@/lib/supabase'
import { getAuthenticatedMember } from '@/lib/api-auth'
import { getServerSupabase } from '@/lib/supabase-server'
import { isValidUuid } from '@/lib/validators'

const supabase = getServerSupabase()

type JoinEventResult = {
  error?: string
  status?: number
  participant_status?: Participant['status']
  participant?: Participant
}

function guestDisplayCode(userCode: string) {
  return userCode.startsWith('guest:') ? userCode.split(':').at(-1) ?? null : null
}

function toPublicParticipant(participant: Participant | null | undefined): PublicParticipant | null {
  if (!participant) return null
  const { user_code: userCode, ...safeParticipant } = participant
  return {
    ...safeParticipant,
    display_code: guestDisplayCode(userCode),
  }
}

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id')
  const requestedMemberId = req.nextUrl.searchParams.get('member_id')
  if (!eventId) {
    return NextResponse.json({ error: 'event_id は必須です' }, { status: 400 })
  }
  if (!isValidUuid(eventId)) {
    return NextResponse.json({ error: 'event_id の形式が正しくありません' }, { status: 400 })
  }

  const auth = await getAuthenticatedMember(req, requestedMemberId)
  if (!auth.member) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const canonicalMemberId = auth.member.id
  const [{ data: participation, error: participationError }, { data: guests, error: guestsError }] =
    await Promise.all([
      supabase
        .from('participants')
        .select('*')
        .eq('event_id', eventId)
        .eq('member_id', canonicalMemberId)
        .neq('status', 'cancelled')
        .limit(1)
        .maybeSingle<Participant>(),
      supabase
        .from('participants')
        .select('*')
        .eq('event_id', eventId)
        .neq('status', 'cancelled')
        .like('user_code', `guest:${canonicalMemberId}:%`)
        .order('created_at', { ascending: true }),
    ])

  if (participationError || guestsError) {
    return NextResponse.json(
      { error: participationError?.message ?? guestsError?.message ?? '参加情報の取得に失敗しました' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    participation: toPublicParticipant(participation),
    guests: ((guests as Participant[] | null) ?? []).map(toPublicParticipant).filter(Boolean),
  })
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
  if (!isValidUuid(event_id)) {
    return NextResponse.json({ error: 'event_id の形式が正しくありません' }, { status: 400 })
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
