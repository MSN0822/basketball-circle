import { Event } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'
import { isVisibleToMembers, withEffectiveEventStatus } from '@/lib/event-visibility'
import MemberHeader from '@/components/MemberHeader'
import EventList from '@/components/EventList'

export const revalidate = 0

async function getEvents(): Promise<Event[]> {
  const supabase = getServerSupabase()
  const { data } = await supabase
    .from('events')
    .select('*')
    .order('event_date', { ascending: true })
  const events = data ?? []

  const nowMs = Date.now()
  return events
    .filter(e => isVisibleToMembers(e, nowMs))
    .map(e => withEffectiveEventStatus(e, nowMs))
}

export default async function HomePage() {
  const events = await getEvents()

  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-4">
      <div className="flex justify-end">
        <MemberHeader />
      </div>
      <h1 className="text-2xl font-bold">ぶらんかーず</h1>

      {events.length === 0 ? (
        <p className="text-muted-foreground">現在公開中のイベントはありません</p>
      ) : (
        <EventList events={events} />
      )}
    </main>
  )
}
