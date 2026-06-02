import { NextRequest, NextResponse } from 'next/server'
import { generateUserCode, Participant } from '@/lib/supabase'
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
    participant: result.participant,
    waitlist: false,
    temporary_code: temporaryCode,
  })
}
