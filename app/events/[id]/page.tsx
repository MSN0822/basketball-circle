import { Event, PublicParticipant } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'
import { isVisibleToMembers, withEffectiveEventStatus } from '@/lib/event-visibility'
import { publishDueDraftEvents } from '@/lib/event-publishing'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import ParticipantList from '@/components/ParticipantList'
import JoinForm from '@/components/JoinForm'
import EventStatusBadge from '@/components/EventStatusBadge'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const revalidate = 0

async function getEvent(id: string): Promise<Event | null> {
  const supabase = getServerSupabase()
  await publishDueDraftEvents(supabase)
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle<Event>()
  if (!data || !isVisibleToMembers(data)) return null
  return withEffectiveEventStatus(data)
}

async function getParticipants(eventId: string): Promise<PublicParticipant[]> {
  const supabase = getServerSupabase()
  const { data } = await supabase
    .from('participants_public')
    .select('id,event_id,name,status,slot_number,created_at,display_code')
    .eq('event_id', eventId)
    .neq('status', 'cancelled')
    .order('slot_number', { ascending: true })
  return (data as PublicParticipant[] | null) ?? []
}

function formatDateRange(startStr: string, endStr: string | null): string {
  const start = new Date(startStr)
  const startText = start.toLocaleString('ja-JP', {
    year: 'numeric',
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
    year: sameDay ? undefined : 'numeric',
    month: sameDay ? undefined : 'long',
    day: sameDay ? undefined : 'numeric',
    weekday: sameDay ? undefined : 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })

  return `${startText} - ${endText}`
}

// このページはログインユーザごとに個人化したレスポンスを返す（revalidate=0 前提）。
// 'use cache' や cacheComponents をこのルートに導入しないこと。
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [event, participants] = await Promise.all([
    getEvent(id),
    getParticipants(id),
  ])

  if (!event) notFound()

  const active = participants.filter(p => p.status === 'active')
  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← イベント一覧
        </Link>
      </div>

      {/* イベント情報 */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">{event.title}</h1>
          <EventStatusBadge event={event} initialActiveCount={active.length} />
        </div>
        <p className="text-sm text-muted-foreground">{formatDateRange(event.event_date, event.event_end_date)}</p>
        {event.location_url ? (
          <a
            href={event.location_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            📍 {event.location}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">📍 {event.location}</p>
        )}
      </div>

      <Separator />

      {/* 参加申請フォーム */}
      {event.status !== 'draft' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              参加申請
            </CardTitle>
          </CardHeader>
          <CardContent>
            <JoinForm
              event={event}
              initialMember={null}
              initialParticipation={null}
              initialGuests={[]}
              initialActiveCount={active.length}
            />
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* 参加者リスト（リアルタイム） */}
      <ParticipantList
        event={event}
        initialParticipants={participants}
        initialMember={null}
        initialMyParticipantIds={[]}
      />
    </main>
  )
}
