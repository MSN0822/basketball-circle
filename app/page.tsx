import { Event } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'
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

  const now = new Date().toISOString()

  // 自動公開：publishes_at を過ぎた draft イベントを accepting に更新
  const toPublish = events
    .filter(e => e.publishes_at && e.publishes_at < now && e.status === 'draft')
    .map(e => e.id)
  if (toPublish.length > 0) {
    await supabase.from('events').update({ status: 'accepting' }).in('id', toPublish)
    events.forEach(e => { if (toPublish.includes(e.id)) e.status = 'accepting' })
  }

  // 自動締め切り：closes_at を過ぎた accepting イベントを closed に更新
  const toClose = events
    .filter(e => e.closes_at && e.closes_at < now && e.status === 'accepting')
    .map(e => e.id)
  if (toClose.length > 0) {
    await supabase.from('events').update({ status: 'closed' }).in('id', toClose)
    events.forEach(e => { if (toClose.includes(e.id)) e.status = 'closed' })
  }

  return events.filter(e => e.status !== 'draft')
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
