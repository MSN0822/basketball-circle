'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Event, Participant } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'

const supabase = getSupabase()

type Props = {
  event: Event
  initialActiveCount: number
}

export default function EventStatusBadge({ event, initialActiveCount }: Props) {
  const [currentEvent, setCurrentEvent] = useState(event)
  const [activeCount, setActiveCount] = useState(initialActiveCount)

  const reload = useCallback(async () => {
    const [{ data: nextEvent }, { count }] = await Promise.all([
      supabase
        .from('events')
        .select('*')
        .eq('id', event.id)
        .single<Event>(),
      supabase
        .from('participants')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event.id)
        .eq('status', 'active'),
    ])

    if (nextEvent) setCurrentEvent(nextEvent)
    setActiveCount(count ?? 0)
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
          setCurrentEvent(current => ({ ...current, ...next }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(participantChannel)
      supabase.removeChannel(eventChannel)
    }
  }, [event.id, reload])

  useEffect(() => {
    function handleParticipantsChanged(browserEvent: globalThis.Event) {
      const detail = (browserEvent as CustomEvent<{ eventId?: string }>).detail
      if (!detail?.eventId || detail.eventId === event.id) reload()
    }

    window.addEventListener('participants-changed', handleParticipantsChanged)
    return () => { window.removeEventListener('participants-changed', handleParticipantsChanged) }
  }, [event.id, reload])

  const now = Date.now()
  const isFull = activeCount >= currentEvent.max_participants
  const isPastDeadline = Boolean(currentEvent.closes_at && new Date(currentEvent.closes_at).getTime() <= now)
  const isClosed = currentEvent.status !== 'accepting' || isFull || isPastDeadline

  return (
    <Badge variant={isClosed ? 'secondary' : 'default'}>
      {isClosed ? '締め切り済み' : '申請受付中'}
    </Badge>
  )
}
