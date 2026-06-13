import { NextRequest, NextResponse } from 'next/server'
import { Participant } from '@/lib/supabase'
import { checkAdmin, getAuthenticatedMember, getBearerToken, safeCompare } from '@/lib/api-auth'
import { getServerSupabase } from '@/lib/supabase-server'
import { isValidUuid } from '@/lib/validators'
import { isVisibleToMembers } from '@/lib/event-visibility'
import { publishDueDraftEvents } from '@/lib/event-publishing'

const supabase = getServerSupabase()

type EventAccess = {
  status: 'accepting' | 'closed' | 'draft'
  publishes_at: string | null
  closes_at: string | null
}

export async function POST(req: NextRequest) {
  const { participant_id, member_id, user_code, admin } = await req.json()

  if (!participant_id) {
    return NextResponse.json({ error: 'participant_id は必須です' }, { status: 400 })
  }
  if (!isValidUuid(participant_id)) {
    return NextResponse.json({ error: 'participant_id の形式が正しくありません' }, { status: 400 })
  }

  const { data: participant } = await supabase
    .from('participants')
    .select('*')
    .eq('id', participant_id)
    .single<Participant>()

  if (!participant) {
    return NextResponse.json({ error: '参加者が見つかりません' }, { status: 404 })
  }

  try {
    await publishDueDraftEvents(supabase)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '予約公開の反映に失敗しました' },
      { status: 500 },
    )
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('status,publishes_at,closes_at')
    .eq('id', participant.event_id)
    .maybeSingle<EventAccess>()

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 })
  }

  if (admin) {
    if (!checkAdmin(req)) {
      return NextResponse.json({ error: '管理者認証に失敗しました' }, { status: 403 })
    }
  } else if (getBearerToken(req)) {
    if (!event || !isVisibleToMembers(event)) {
      return NextResponse.json({ error: '参加者が見つかりません' }, { status: 404 })
    }

    const auth = await getAuthenticatedMember(req, member_id ?? null)
    if (!auth.member) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const ownsGuest = participant.user_code.startsWith(`guest:${auth.member.id}:`)
    if (participant.member_id !== auth.member.id && !ownsGuest) {
      return NextResponse.json({ error: '本人確認に失敗しました' }, { status: 403 })
    }
  } else if (!participant.member_id && !participant.user_code.startsWith('guest:') && safeCompare(user_code, participant.user_code)) {
    if (!event || !isVisibleToMembers(event)) {
      return NextResponse.json({ error: '参加者が見つかりません' }, { status: 404 })
    }

    // Legacy non-member cancellations are still allowed by temporary code.
  } else {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  if (participant.status !== 'active' && participant.status !== 'waitlist') {
    return NextResponse.json({ error: 'すでにキャンセル済みです' }, { status: 400 })
  }

  const { data: result, error: cancelError } = await supabase.rpc('cancel_participant', {
    p_participant_id: participant_id,
  })

  if (cancelError) {
    return NextResponse.json({ error: cancelError.message }, { status: 500 })
  }

  const payload = result as { error?: string; status?: number } | null
  if (payload?.error) {
    return NextResponse.json({ error: payload.error }, { status: payload.status ?? 400 })
  }

  return NextResponse.json({ success: true })
}
