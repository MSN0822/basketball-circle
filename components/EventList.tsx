'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Event, Participant } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'

const supabase = getSupabase()
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export default function EventList({ events }: { events: Event[] }) {
  const router = useRouter()
  const [myParticipations, setMyParticipations] = useState<Record<string, Participant>>({})

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

  return (
    <div className="space-y-4">
      {events.map(event => {
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
                <CardDescription>{formatDate(event.event_date)}</CardDescription>
                {event.location_url ? (
                  <a
                    href={event.location_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    📍 {event.location}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">📍 {event.location}</p>
                )}
              </CardHeader>
            </Card>
          </div>
        )
      })}
    </div>
  )
}
