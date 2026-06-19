'use client'

import { useCallback, useEffect, useState } from 'react'
import { Event, Member, PublicParticipant } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'
import { withEffectiveEventStatus } from '@/lib/event-visibility'

const supabase = getSupabase()
import { Badge } from '@/components/ui/badge'

async function getJsonAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(data.session?.access_token
      ? { Authorization: `Bearer ${data.session.access_token}` }
      : {}),
  }
}

interface Props {
  event: Event
  initialParticipants: PublicParticipant[]
  initialMember: Member | null
  initialMyParticipantIds: string[]
}

type ParticipantsChangedDetail = {
  eventId?: string
  action?: 'upsert' | 'remove'
  participant?: PublicParticipant
  participantId?: string
}

function sortParticipants(rows: PublicParticipant[]) {
  return [...rows].sort((a, b) => {
    const slotA = a.slot_number ?? Number.MAX_SAFE_INTEGER
    const slotB = b.slot_number ?? Number.MAX_SAFE_INTEGER
    if (slotA !== slotB) return slotA - slotB
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
}

export default function ParticipantList({ event, initialParticipants, initialMember, initialMyParticipantIds }: Props) {
  const [participants, setParticipants] = useState<PublicParticipant[]>(initialParticipants)
  const [currentEvent, setCurrentEvent] = useState<Event>(event)
  const [member, setMember] = useState<Member | null>(initialMember)
  const [myParticipantIds, setMyParticipantIds] = useState<Set<string>>(new Set(initialMyParticipantIds))

  const reloadMine = useCallback(async (memberId: string) => {
    const res = await fetch(`/api/participants?event_id=${encodeURIComponent(event.id)}&member_id=${encodeURIComponent(memberId)}`, {
      headers: await getJsonAuthHeaders(),
    })
    if (!res.ok) {
      setMyParticipantIds(new Set())
      return
    }

    const data = await res.json().catch(() => ({})) as {
      participation?: PublicParticipant | null
      guests?: PublicParticipant[]
    }
    setMyParticipantIds(new Set([
      ...(data.participation ? [data.participation.id] : []),
      ...((data.guests ?? []).map(guest => guest.id)),
    ]))
  }, [event.id])

  useEffect(() => {
    // SSR（page.tsx）で解決済みなら初期フェッチは不要。
    // フォールバック時の getSession() はローカル読みでネットワーク往復を増やさない。
    if (initialMember) return

    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return
      const { data } = await supabase
        .from('members')
        .select('*')
        .eq('auth_user_id', user.id)
        .single()
      if (data) {
        setMember(data)
        await reloadMine(data.id)
      }
    }
    load()
  }, [initialMember, reloadMine])

  const reloadParticipants = useCallback(async () => {
    const res = await fetch(`/api/participants?event_id=${encodeURIComponent(event.id)}`, {
      headers: await getJsonAuthHeaders(),
    })
    if (!res.ok) return

    const data = await res.json().catch(() => ({})) as { participants?: PublicParticipant[] }
    setParticipants(data.participants ?? [])
  }, [event.id])

  const reloadEvent = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('id', event.id)
      .single<Event>()

    if (data) setCurrentEvent(withEffectiveEventStatus(data))
  }, [event.id])

  useEffect(() => {
    const channel = supabase
      .channel(`participants:${event.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `event_id=eq.${event.id}` },
        () => {
          reloadParticipants()
          reloadEvent()
          if (member) reloadMine(member.id)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [event.id, member, reloadEvent, reloadMine, reloadParticipants])

  useEffect(() => {
    const interval = window.setInterval(() => {
      reloadParticipants()
      reloadEvent()
      if (member) reloadMine(member.id)
    }, 15_000)
    return () => { window.clearInterval(interval) }
  }, [member, reloadEvent, reloadMine, reloadParticipants])

  useEffect(() => {
    const channel = supabase
      .channel(`participant-list-event:${event.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${event.id}` },
        payload => {
          const next = payload.new as Partial<Event>
          setCurrentEvent(current => withEffectiveEventStatus({ ...current, ...next }))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [event.id])

  useEffect(() => {
    function handleParticipantsChanged(browserEvent: globalThis.Event) {
      const detail = (browserEvent as CustomEvent<ParticipantsChangedDetail>).detail
      if (detail?.eventId && detail.eventId !== event.id) return

      if (detail?.action === 'upsert' && detail.participant) {
        const nextParticipant = detail.participant
        setParticipants(current => sortParticipants([
          ...current.filter(participant => participant.id !== nextParticipant.id),
          nextParticipant,
        ]))
        if (member) {
          setMyParticipantIds(current => new Set([...current, nextParticipant.id]))
        }
      }

      if (detail?.action === 'remove' && detail.participantId) {
        const removedParticipantId = detail.participantId
        setParticipants(current => current.filter(participant => participant.id !== removedParticipantId))
        if (member) {
          setMyParticipantIds(current => {
            const next = new Set(current)
            next.delete(removedParticipantId)
            return next
          })
        }
      }

      void reloadParticipants()
      void reloadEvent()
      if (member) void reloadMine(member.id)
    }

    window.addEventListener('participants-changed', handleParticipantsChanged)
    return () => { window.removeEventListener('participants-changed', handleParticipantsChanged) }
  }, [event.id, member, reloadEvent, reloadMine, reloadParticipants])

  const active = participants.filter(p => p.status === 'active')
  const waitlist = participants.filter(p => p.status === 'waitlist')

  const myParticipation = member
    ? participants.find(p => myParticipantIds.has(p.id))
    : null

  return (
    <div className="space-y-6">
      {/* 自分の参加状況 */}
      {myParticipation && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm font-medium text-blue-800">
            {myParticipation.status === 'active'
              ? `✅ 参加中（${myParticipation.slot_number}番）`
              : `⏳ キャンセル待ち（待${myParticipation.slot_number}番）`}
          </p>
        </div>
      )}

      {/* 参加者リスト */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-semibold text-lg">参加者</h2>
          <Badge variant={active.length >= currentEvent.max_participants ? 'destructive' : 'secondary'}>
            {active.length} / {currentEvent.max_participants}
          </Badge>
        </div>
        <div className="space-y-1">
          {active.map(p => (
            <div
              key={p.id}
              className={`flex items-center justify-between px-3 py-2 rounded-md ${
                member && myParticipantIds.has(p.id) ? 'bg-blue-50 border border-blue-200' : 'bg-muted/50'
              }`}
            >
              <span className="text-sm">
                <span className="text-muted-foreground mr-2">{p.slot_number}.</span>
                {p.name}
                {member && myParticipantIds.has(p.id) && (
                  <span className="ml-2 text-xs text-blue-600">（自分）</span>
                )}
                {p.display_code && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    臨時ID: {p.display_code}
                  </span>
                )}
              </span>
            </div>
          ))}
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground px-3">まだ参加者がいません</p>
          )}
        </div>
      </div>

      {/* キャンセル待ちリスト */}
      {waitlist.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-lg">キャンセル待ち</h2>
            <Badge variant="outline">{waitlist.length}人</Badge>
          </div>
          <div className="space-y-1">
            {waitlist.map(p => (
              <div
                key={p.id}
                className={`flex items-center px-3 py-2 rounded-md ${
                  member && myParticipantIds.has(p.id) ? 'bg-blue-50 border border-blue-200' : 'bg-muted/30'
                }`}
              >
                <span className="text-sm text-muted-foreground">
                  <span className="mr-2">待{p.slot_number}.</span>
                  {p.name}
                  {member && myParticipantIds.has(p.id) && (
                    <span className="ml-2 text-xs text-blue-600">（自分）</span>
                  )}
                  {p.display_code && (
                    <span className="ml-2 text-xs">
                      臨時ID: {p.display_code}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
