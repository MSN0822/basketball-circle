import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateUserCode, Event, Participant } from '@/lib/supabase'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { event_id, name, member_id } = await req.json()

  if (!event_id || !name?.trim()) {
    return NextResponse.json({ error: '名前とイベントIDは必須です' }, { status: 400 })
  }

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', event_id)
    .single<Event>()

  if (!event) {
    return NextResponse.json({ error: 'イベントが見つかりません' }, { status: 404 })
  }

  // 同じイベントに既に登録済みでないか確認（会員の場合）
  if (member_id) {
    const { data: existing } = await supabase
      .from('participants')
      .select('id, status')
      .eq('event_id', event_id)
      .eq('member_id', member_id)
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
    .eq('event_id', event_id)
    .eq('status', 'active')

  const current = activeCount ?? 0
  const user_code = generateUserCode()

  if (event.status === 'accepting' && current < event.max_participants) {
    const slot_number = current + 1
    const { data, error } = await supabase
      .from('participants')
      .insert({ event_id, name: name.trim(), user_code, member_id: member_id ?? null, status: 'active', slot_number })
      .select()
      .single<Participant>()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ participant: data })
  }

  const { count: waitlistCount } = await supabase
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', event_id)
    .eq('status', 'waitlist')

  const waitSlot = (waitlistCount ?? 0) + 1
  const { data, error } = await supabase
    .from('participants')
    .insert({ event_id, name: name.trim(), user_code, member_id: member_id ?? null, status: 'waitlist', slot_number: waitSlot })
    .select()
    .single<Participant>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ participant: data, waitlist: true })
}
