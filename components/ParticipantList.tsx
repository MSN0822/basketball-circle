'use client'

import { useCallback, useEffect, useState } from 'react'
import { Participant, Event, Member } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'

const supabase = getSupabase()
import { Badge } from '@/components/ui/badge'

interface Props {
  event: Event
  initialParticipants: Participant[]
}

function getTemporaryGuestCode(participant: Participant) {
  if (!participant.user_code.startsWith('guest:')) return null
  return participant.user_code.split(':').at(-1) ?? null
}

export default function ParticipantList({ event, initialParticipants }: Props) {
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants)
  const [currentEvent, setCurrentEvent] = useState<Event>(event)
  const [member, setMember] = useState<Member | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('members')
        .select('*')
        .eq('auth_user_id', user.id)
        .single()
      if (data) setMember(data)
    }
    load()
  }, [])

  const reloadParticipants = useCallback(async () => {
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('event_id', event.id)
      .neq('status', 'cancelled')
      .order('slot_number', { ascending: true })

    if (data) setParticipants(data)
  }, [event.id])

  const reloadEvent = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('id', event.id)
      .single<Event>()

    if (data) setCurrentEvent(data)
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
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [event.id, reloadEvent, reloadParticipants])

  useEffect(() => {
    const channel = supabase
      .channel(`participant-list-event:${event.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${event.id}` },
        payload => {
          const next = payload.new as Partial<Event>
          setCurrentEvent(current => ({ ...current, ...next }))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [event.id])

  useEffect(() => {
    function handleParticipantsChanged(browserEvent: globalThis.Event) {
      const detail = (browserEvent as CustomEvent<{ eventId?: string }>).detail
      if (!detail?.eventId || detail.eventId === event.id) {
        reloadParticipants()
        reloadEvent()
      }
    }

    window.addEventListener('participants-changed', handleParticipantsChanged)
    return () => { window.removeEventListener('participants-changed', handleParticipantsChanged) }
  }, [event.id, reloadEvent, reloadParticipants])

  const active = participants.filter(p => p.status === 'active')
  const waitlist = participants.filter(p => p.status === 'waitlist')

  const myParticipation = member
    ? participants.find(p => p.member_id === member.id)
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
                member && p.member_id === member.id ? 'bg-blue-50 border border-blue-200' : 'bg-muted/50'
              }`}
            >
              <span className="text-sm">
                <span className="text-muted-foreground mr-2">{p.slot_number}.</span>
                {p.name}
                {member && p.member_id === member.id && (
                  <span className="ml-2 text-xs text-blue-600">（自分）</span>
                )}
                {getTemporaryGuestCode(p) && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    臨時ID: {getTemporaryGuestCode(p)}
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
                  member && p.member_id === member.id ? 'bg-blue-50 border border-blue-200' : 'bg-muted/30'
                }`}
              >
                <span className="text-sm text-muted-foreground">
                  <span className="mr-2">待{p.slot_number}.</span>
                  {p.name}
                  {member && p.member_id === member.id && (
                    <span className="ml-2 text-xs text-blue-600">（自分）</span>
                  )}
                  {getTemporaryGuestCode(p) && (
                    <span className="ml-2 text-xs">
                      臨時ID: {getTemporaryGuestCode(p)}
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
