'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Event } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'
import { withEffectiveEventStatus } from '@/lib/event-visibility'

const supabase = getSupabase()

async function getJsonAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(data.session?.access_token
      ? { Authorization: `Bearer ${data.session.access_token}` }
      : {}),
  }
}

type Props = {
  event: Event
  initialActiveCount: number
}

type ParticipantsChangedDetail = {
  eventId?: string
  activeDelta?: number
}

export default function EventStatusBadge({ event, initialActiveCount }: Props) {
  const [currentEvent, setCurrentEvent] = useState(event)
  const [activeCount, setActiveCount] = useState(initialActiveCount)

  const reload = useCallback(async () => {
    const [{ data: nextEvent }, participantsRes] = await Promise.all([
      supabase
        .from('events')
        .select('*')
        .eq('id', event.id)
        .single<Event>(),
      fetch(`/api/participants?event_id=${encodeURIComponent(event.id)}`, {
        headers: await getJsonAuthHeaders(),
      }),
    ])

    if (nextEvent) setCurrentEvent(withEffectiveEventStatus(nextEvent))
    if (participantsRes.ok) {
      const data = await participantsRes.json().catch(() => ({})) as { participants?: { status?: string }[] }
      setActiveCount((data.participants ?? []).filter(participant => participant.status === 'active').length)
    }
  }, [event.id])

  useEffect(() => {
    const participantChannel = supabase
      .channel(`event-status-participants:${event.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `event_id=eq.${event.id}` },
        () => { reload() }
      )
      .subscribe()

    const eventChannel = supabase
      .channel(`event-status-event:${event.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${event.id}` },
        payload => {
          const next = payload.new as Partial<Event>
          setCurrentEvent(current => withEffectiveEventStatus({ ...current, ...next }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(participantChannel)
      supabase.removeChannel(eventChannel)
    }
  }, [event.id, reload])

  useEffect(() => {
    const interval = window.setInterval(reload, 15_000)
    return () => { window.clearInterval(interval) }
  }, [reload])

  useEffect(() => {
    function handleParticipantsChanged(browserEvent: globalThis.Event) {
      const detail = (browserEvent as CustomEvent<ParticipantsChangedDetail>).detail
      if (detail?.eventId && detail.eventId !== event.id) return
      if (typeof detail?.activeDelta === 'number') {
        setActiveCount(current => Math.max(current + detail.activeDelta!, 0))
      }
      void reload()
    }

    window.addEventListener('participants-changed', handleParticipantsChanged)
    return () => { window.removeEventListener('participants-changed', handleParticipantsChanged) }
  }, [event.id, reload])

  const isFull = activeCount >= currentEvent.max_participants
  const isClosed = currentEvent.status !== 'accepting' || isFull

  return (
    <Badge variant={isClosed ? 'secondary' : 'default'}>
      {isClosed ? '締め切り済み' : '申請受付中'}
    </Badge>
  )
}
