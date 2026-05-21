import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Participant, Event } from '@/lib/supabase'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { participant_id, member_id, user_code, admin } = await req.json()

  if (!participant_id) {
    return NextResponse.json({ error: 'participant_id は必須です' }, { status: 400 })
  }

  const { data: participant } = await supabase
    .from('participants')
    .select('*')
    .eq('id', participant_id)
    .single<Participant>()

  if (!participant) {
    return NextResponse.json({ error: '参加者が見つかりません' }, { status: 404 })
  }

  if (participant.status !== 'active' && participant.status !== 'waitlist') {
    return NextResponse.json({ error: 'すでにキャンセル済みです' }, { status: 400 })
  }

  if (admin) {
    // 管理者パスワード確認
    if (user_code !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: '管理者パスワードが一致しません' }, { status: 403 })
    }
  } else if (member_id) {
    // 会員IDで本人確認
    if (participant.member_id !== member_id) {
      return NextResponse.json({ error: '本人確認に失敗しました' }, { status: 403 })
    }
  } else {
    // フォールバック：参加コードで確認
    if (!user_code || participant.user_code !== user_code) {
      return NextResponse.json({ error: '参加コードが一致しません' }, { status: 403 })
    }
  }

  const wasActive = participant.status === 'active'

  // キャンセルに更新
  await supabase
    .from('participants')
    .update({ status: 'cancelled' })
    .eq('id', participant_id)

  // activeだった場合、threshold以下になったらwaitlist先頭を繰り上げ
  if (wasActive) {
    const { count: activeCount } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', participant.event_id)
      .eq('status', 'active')

    const { data: event } = await supabase
      .from('events')
      .select('threshold, max_participants')
      .eq('id', participant.event_id)
      .single<Event>()

    const current = activeCount ?? 0
    if (event && current < event.threshold) {
      // waitlist先頭を繰り上げ
      const { data: next } = await supabase
        .from('participants')
        .select('*')
        .eq('event_id', participant.event_id)
        .eq('status', 'waitlist')
        .order('slot_number', { ascending: true })
        .limit(1)
        .single<Participant>()

      if (next) {
        const newSlot = current + 1
        await supabase
          .from('participants')
          .update({ status: 'active', slot_number: newSlot })
          .eq('id', next.id)
      }
    }
  }

  return NextResponse.json({ success: true })
}
