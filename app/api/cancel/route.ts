import { NextRequest, NextResponse } from 'next/server'
import { Event, Participant } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'

const supabase = getServerSupabase()

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

async function normalizeSlots(eventId: string) {
  const [{ data: activeData }, { data: waitlistData }] = await Promise.all([
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

  await Promise.all([
    ...active.map((p, index) =>
      updateParticipant(p.id, { status: 'active', slot_number: index + 1 })
    ),
    ...waitlist.map((p, index) =>
      updateParticipant(p.id, { status: 'waitlist', slot_number: index + 1 })
    ),
  ])
}

async function syncEventStatusAfterActiveCancel(eventId: string) {
  const [{ data: event }, { count: activeCount }] = await Promise.all([
    supabase
      .from('events')
      .select('status, threshold, max_participants, closes_at')
      .eq('id', eventId)
      .single<Event>(),
    supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'active'),
  ])

  if (!event || event.status === 'draft') return

  const active = activeCount ?? 0
  const isPastDeadline = Boolean(event.closes_at && new Date(event.closes_at).getTime() <= Date.now())
  const nextStatus =
    isPastDeadline || active >= event.max_participants
      ? 'closed'
      : active < event.threshold
        ? 'accepting'
        : event.status

  if (nextStatus !== event.status) {
    await supabase
      .from('events')
      .update({ status: nextStatus })
      .eq('id', eventId)
  }
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
    await normalizeSlots(participant.event_id)
    if (wasActive) {
      await syncEventStatusAfterActiveCancel(participant.event_id)
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '参加番号の更新に失敗しました' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
