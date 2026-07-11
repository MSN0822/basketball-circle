import { NextRequest, NextResponse } from 'next/server'
import { Event } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'
import { isValidUuid } from '@/lib/validators'
import { isVisibleToMembers } from '@/lib/event-visibility'
import { buildEventIcs } from '@/lib/ics'

const supabase = getServerSupabase()

type IcsEvent = Pick<
  Event,
  'id' | 'title' | 'event_date' | 'event_end_date' | 'location' | 'location_url' | 'status' | 'publishes_at'
>

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'イベントIDの形式が正しくありません' }, { status: 400 })
  }

  const { data: event, error } = await supabase
    .from('events')
    .select('id,title,event_date,event_end_date,location,location_url,status,publishes_at')
    .eq('id', id)
    .maybeSingle<IcsEvent>()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!event || !isVisibleToMembers(event)) {
    return NextResponse.json({ error: 'イベントが見つかりません' }, { status: 404 })
  }

  const ics = buildEventIcs(event, {
    siteEventUrl: new URL(`/events/${id}`, req.nextUrl.origin).toString(),
    uidHost: req.nextUrl.hostname,
  })

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="event.ics"',
      'Cache-Control': 'no-store',
    },
  })
}
