import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Event, Participant } from '@/lib/supabase'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type ParticipantPatch = {
  status?: Participant['status']
  slot_number?: number | null
}

async function updateParticipant(id: string, patch: ParticipantPatch) {
  const { error } = await supabase
    .from('participants')
    .update(patch)
    .eq('id', id)

  if (error) throw error
}

async function normalizeSlots(eventId: string, shouldPromote: boolean) {
  const [{ data: event }, { data: activeData }, { data: waitlistData }] = await Promise.all([
    supabase
      .from('events')
      .select('threshold, max_participants')
      .eq('id', eventId)
      .single<Event>(),
    supabase
      .from('participants')
      .select('*')
      .eq('event_id', eventId)
      .eq('status', 'active')
      .order('slot_number', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('participants')
      .select('*')
      .eq('event_id', eventId)
      .eq('status', 'waitlist')
      .order('slot_number', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  const active = activeData ?? []
  const waitlist = waitlistData ?? []

  if (shouldPromote && event && active.length < event.threshold && waitlist.length > 0) {
    const [next, ...remainingWaitlist] = waitlist
    const promotedActive = [...active, { ...next, status: 'active' as const }]

    await Promise.all([
      ...promotedActive.map((p, index) =>
        updateParticipant(p.id, { status: 'active', slot_number: index + 1 })
      ),
      ...remainingWaitlist.map((p, index) =>
        updateParticipant(p.id, { status: 'waitlist', slot_number: index + 1 })
      ),
    ])
    return
  }

  await Promise.all([
    ...active.map((p, index) =>
      updateParticipant(p.id, { status: 'active', slot_number: index + 1 })
    ),
    ...waitlist.map((p, index) =>
      updateParticipant(p.id, { status: 'waitlist', slot_number: index + 1 })
    ),
  ])
}

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
    if (user_code !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: '管理者パスワードが一致しません' }, { status: 403 })
    }
  } else if (member_id) {
    const ownsGuest = participant.user_code.startsWith(`guest:${member_id}:`)
    if (participant.member_id !== member_id && !ownsGuest) {
      return NextResponse.json({ error: '本人確認に失敗しました' }, { status: 403 })
    }
  } else if (!user_code || participant.user_code !== user_code) {
    return NextResponse.json({ error: '参加コードが一致しません' }, { status: 403 })
  }

  const wasActive = participant.status === 'active'

  const { error: cancelError } = await supabase
    .from('participants')
    .update({ status: 'cancelled' })
    .eq('id', participant_id)

  if (cancelError) {
    return NextResponse.json({ error: cancelError.message }, { status: 500 })
  }

  try {
    await normalizeSlots(participant.event_id, wasActive)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '参加番号の更新に失敗しました' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
