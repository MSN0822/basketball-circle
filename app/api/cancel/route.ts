import { NextRequest, NextResponse } from 'next/server'
import type { Participant } from '@/lib/supabase'
import { checkAdmin, getAuthenticatedMember, getBearerToken, safeCompare } from '@/lib/api-auth'
import { resolveServerSupabase } from '@/lib/route-supabase'
import { clientIdentifier, enforceRateLimit } from '@/lib/rate-limit'
import { CANCEL_LEGACY_LIMIT, CANCEL_MEMBER_LIMIT } from '@/lib/api-rate-limits'
import { isValidUuid } from '@/lib/validators'
import { isVisibleToMembers } from '@/lib/event-visibility'
import { publishDueDraftEvents } from '@/lib/event-publishing'

type EventAccess = {
  status: 'accepting' | 'closed' | 'draft' | 'archived'
  publishes_at: string | null
}

export async function POST(req: NextRequest) {
  const resolved = resolveServerSupabase()
  if (resolved.response) return resolved.response
  const supabase = resolved.supabase

  const { participant_id, member_id, user_code, admin } = await req.json()

  if (!participant_id) {
    return NextResponse.json({ error: 'participant_id は必須です' }, { status: 400 })
  }
  if (!isValidUuid(participant_id)) {
    return NextResponse.json({ error: 'participant_id の形式が正しくありません' }, { status: 400 })
  }

  const { data: participant, error: participantError } = await supabase
    .from('participants')
    .select('*')
    .eq('id', participant_id)
    .single<Participant>()

  // PGRST116 = 0行（not found）。それ以外の error は DB 障害なので 404 にしない
  if (participantError && participantError.code !== 'PGRST116') {
    return NextResponse.json({ error: participantError.message }, { status: 500 })
  }

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
    .select('status,publishes_at')
    .eq('id', participant.event_id)
    .maybeSingle<EventAccess>()

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 })
  }

  // 臨時コード（5桁）によるキャンセルは総当たりが可能なため、認可の成否に関わらず
  // IP キーで数える。Vercel は x-real-ip を実IPで上書きするので偽装は効かないが、
  // 同一回線の複数利用者が巻き添えになる点を踏まえて上限は控えめにしている。
  if (!admin && !getBearerToken(req)) {
    const legacyLimited = await enforceRateLimit(`cancel:ip:${clientIdentifier(req)}`, CANCEL_LEGACY_LIMIT)
    if (legacyLimited) return legacyLimited
  }

  if (admin) {
    if (!checkAdmin(req)) {
      return NextResponse.json({ error: '管理者認証に失敗しました' }, { status: 403 })
    }
    // アーカイブ済みイベントは操作対象外（管理画面UIも同様にボタンを非表示にしている）。
    if (event?.status === 'archived') {
      return NextResponse.json({ error: 'アーカイブ済みのイベントは操作できません' }, { status: 409 })
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

    // 認証で解決された会員IDをキーにする（body の member_id は使わない）。
    const memberLimited = await enforceRateLimit(`cancel:member:${auth.member.id}`, CANCEL_MEMBER_LIMIT)
    if (memberLimited) return memberLimited
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
