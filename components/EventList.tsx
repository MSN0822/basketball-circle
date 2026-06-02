'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Event, Participant } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const supabase = getSupabase()

function formatDateRange(startStr: string, endStr: string | null): string {
  const start = new Date(startStr)
  const startText = start.toLocaleString('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })

  if (!endStr) return startText

  const end = new Date(endStr)
  const sameDay = start.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) === end.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const endText = end.toLocaleString('ja-JP', {
    month: sameDay ? undefined : 'long',
    day: sameDay ? undefined : 'numeric',
    weekday: sameDay ? undefined : 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })

  return `${startText} - ${endText}`
}

export default function EventList({ events }: { events: Event[] }) {
  const router = useRouter()
  const [visibleEvents, setVisibleEvents] = useState(events)
  const [myParticipations, setMyParticipations] = useState<Record<string, Participant>>({})

  useEffect(() => {
    setVisibleEvents(events)
  }, [events])

  async function reloadEvents() {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('event_date', { ascending: true })

    if (data) setVisibleEvents(data.filter(event => event.status !== 'draft'))
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: member } = await supabase
        .from('members')
        .select('id')
        .eq('auth_user_id', user.id)
        .single()
      if (!member) return

      const { data: participations } = await supabase
        .from('participants')
        .select('*')
        .eq('member_id', member.id)
        .in('status', ['active', 'waitlist'])

      if (participations) {
        const map: Record<string, Participant> = {}
        participations.forEach(p => { map[p.event_id] = p })
        setMyParticipations(map)
      }
    }
    load()
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('event-list-events')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        () => { reloadEvents() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="space-y-4">
      {visibleEvents.map(event => {
        const myP = myParticipations[event.id]
        return (
          <div key={event.id} onClick={() => router.push(`/events/${event.id}`)} className="cursor-pointer">
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-base">{event.title}</CardTitle>
                <div className="flex items-center gap-1.5">
                  <Badge variant={event.status === 'accepting' ? 'default' : 'secondary'}>
                    {event.status === 'accepting' ? '申請受付中' : '締め切り済み'}
                  </Badge>
                  {myP && (
                    <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 text-xs">
                      {myP.status === 'active' ? '✅ 申請済み' : '⏳ 待機中'}
                    </Badge>
                  )}
                </div>
                <CardDescription>{formatDateRange(event.event_date, event.event_end_date)}</CardDescription>
                <p className="text-sm text-muted-foreground">📍 {event.location}</p>
              </CardHeader>
            </Card>
          </div>
        )
      })}
    </div>
  )
}
