import { NextRequest, NextResponse } from 'next/server'
import { generateUserCode, Event, Participant } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'

const supabase = getServerSupabase()

type JoinEventResult = {
  error?: string
  status?: number
  participant_status?: Participant['status']
  participant?: Participant
  waitlist?: boolean
}

type RpcError = {
  code?: string
  message?: string
}

const CLOSED_MESSAGE = '定員に達したため締め切りました。参加枠が閾値未満になるまで追加申請できません'
const NOT_ACCEPTING_MESSAGE = '現在は参加申請を受け付けていません'
const DEADLINE_MESSAGE = '締切日時を過ぎたため参加申請を受け付けていません'

function shouldFallbackToLegacyJoin(error: RpcError): boolean {
  return error.code === 'PGRST202' || Boolean(error.message?.includes('join_event'))
}

async function legacyJoin(eventId: string, name: string, memberId: string | null, guest: boolean, temporaryCode: string) {
  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single<Event>()

  if (!event) {
    return NextResponse.json({ error: 'イベントが見つかりません' }, { status: 404 })
  }

  if (guest) {
    if (!memberId) {
      return NextResponse.json({ error: '招待元の会員情報が必要です' }, { status: 400 })
    }

    const guestPrefix = `guest:${memberId}:`
    const { count: guestCount } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .neq('status', 'cancelled')
      .like('user_code', `${guestPrefix}%`)

    if ((guestCount ?? 0) >= 3) {
      return NextResponse.json({ error: '友達の臨時ID発行は1イベント3名までです' }, { status: 400 })
    }
  }

  if (memberId && !guest) {
    const { data: existing } = await supabase
      .from('participants')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('member_id', memberId)
      .neq('status', 'cancelled')
      .single<Participant>()

    if (existing) {
      return NextResponse.json(
        { error: 'すでにこのイベントに登録済みです', status: existing.status },
        { status: 409 }
      )
    }
  }

  const { count: activeCount } = await supabase
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'active')

  const current = activeCount ?? 0
  const userCode = guest ? `guest:${memberId}:${temporaryCode}` : temporaryCode
  const participantMemberId = guest ? null : memberId

  if (event.closes_at && new Date(event.closes_at).getTime() <= Date.now()) {
    if (event.status === 'accepting') {
      await supabase.from('events').update({ status: 'closed' }).eq('id', eventId)
    }
    return NextResponse.json({ error: DEADLINE_MESSAGE }, { status: 409 })
  }

  if (event.status !== 'accepting') {
    return NextResponse.json({ error: NOT_ACCEPTING_MESSAGE }, { status: 409 })
  }

  if (current >= event.max_participants) {
    await supabase.from('events').update({ status: 'closed' }).eq('id', eventId)
    return NextResponse.json({ error: CLOSED_MESSAGE }, { status: 409 })
  }

  const slotNumber = current + 1
  const { data, error } = await supabase
    .from('participants')
    .insert({
      event_id: eventId,
      name,
      user_code: userCode,
      member_id: participantMemberId,
      status: 'active',
      slot_number: slotNumber,
    })
    .select()
    .single<Participant>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (slotNumber >= event.max_participants) {
    await supabase.from('events').update({ status: 'closed' }).eq('id', eventId)
  }

  return NextResponse.json({ participant: data, temporary_code: temporaryCode })
}

export async function POST(req: NextRequest) {
  const { event_id, name, member_id, guest } = await req.json()

  const trimmedName = name?.trim()

  if (!event_id || !trimmedName) {
    return NextResponse.json({ error: '名前とイベントIDは必須です' }, { status: 400 })
  }

  if (guest && !member_id) {
    return NextResponse.json({ error: '招待元の会員情報が必要です' }, { status: 400 })
  }

  const temporaryCode = generateUserCode()
  const user_code = guest ? `guest:${member_id}:${temporaryCode}` : temporaryCode

  const { data, error } = await supabase.rpc('join_event', {
    p_event_id: event_id,
    p_name: trimmedName,
    p_user_code: user_code,
    p_member_id: member_id ?? null,
    p_is_guest: Boolean(guest),
  })

  if (error) {
    if (shouldFallbackToLegacyJoin(error)) {
      return legacyJoin(event_id, trimmedName, member_id ?? null, Boolean(guest), temporaryCode)
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
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

  if (result.waitlist) {
    if (result.participant?.id) {
      await supabase
        .from('participants')
        .delete()
        .eq('id', result.participant.id)
    }
    return NextResponse.json({ error: CLOSED_MESSAGE }, { status: 409 })
  }

  return NextResponse.json({
    participant: result.participant,
    waitlist: false,
    temporary_code: temporaryCode,
  })
}
