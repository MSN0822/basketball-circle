'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Event, PublicParticipant } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'
import { isVisibleToMembers, withEffectiveEventStatus } from '@/lib/event-visibility'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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

interface Props {
  events: Event[]
  // null = SSR で申請状況を解決できなかった（クライアント側フォールバックで取得する）
  initialMyParticipations: PublicParticipant[] | null
}

function toParticipationMap(participations: PublicParticipant[] | null): Record<string, PublicParticipant> {
  const map: Record<string, PublicParticipant> = {}
  participations?.forEach(p => { map[p.event_id] = p })
  return map
}

export default function EventList({ events, initialMyParticipations }: Props) {
  const [realtimeEvents, setRealtimeEvents] = useState<Event[] | null>(null)
  const [myParticipations, setMyParticipations] = useState<Record<string, PublicParticipant>>(
    () => toParticipationMap(initialMyParticipations)
  )
  const visibleEvents = realtimeEvents ?? events

  const reloadEvents = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('event_date', { ascending: true })

    if (data) {
      setRealtimeEvents(data.filter(event => isVisibleToMembers(event)).map(event => withEffectiveEventStatus(event)))
    }
  }, [])

  useEffect(() => {
    // SSR（page.tsx）で申請状況を解決済みなら初期フェッチは不要。
    if (initialMyParticipations) return

    // フォールバック: getSession() はローカル読みのためネットワーク往復を増やさない。
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return

      const { data: member } = await supabase
        .from('members')
        .select('id')
        .eq('auth_user_id', user.id)
        .single()
      if (!member) return

      const res = await fetch(`/api/participants?member_id=${encodeURIComponent(member.id)}`, {
        headers: await getJsonAuthHeaders(),
      })
      if (!res.ok) return

      const { participations } = await res.json() as { participations?: PublicParticipant[] }

      if (participations) {
        setMyParticipations(toParticipationMap(participations))
      }
    }
    load()
  }, [initialMyParticipations])

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
  }, [reloadEvents])

  return (
    <div className="space-y-4">
      {visibleEvents.map(event => {
        const myP = myParticipations[event.id]
        return (
          <Link
            key={event.id}
            href={`/events/${event.id}`}
            prefetch
            className="block"
          >
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
          </Link>
        )
      })}
    </div>
  )
}
