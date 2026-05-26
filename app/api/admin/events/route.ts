import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function checkAdmin(req: NextRequest): boolean {
  const password = req.headers.get('x-admin-password')
  return password === process.env.ADMIN_PASSWORD
}

function isEndAfterStart(start: string, end: string): boolean {
  return new Date(end).getTime() > new Date(start).getTime()
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: '認証エラー' }, { status: 403 })
  }

  const body = await req.json()
  const { title, event_date, event_end_date, location, location_url = null, closes_at = null, publishes_at = null, max_participants = 40, threshold = 30, status = 'accepting' } = body

  if (!title || !event_date || !event_end_date || !location) {
    return NextResponse.json({ error: 'title, event_date, event_end_date, location は必須です' }, { status: 400 })
  }

  if (!isEndAfterStart(event_date, event_end_date)) {
    return NextResponse.json({ error: 'event_end_date は event_date より後にしてください' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('events')
    .insert({ title, event_date, event_end_date, location, location_url, closes_at, publishes_at, max_participants, threshold, status })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ event: data })
}

export async function DELETE(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: '認証エラー' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id は必須です' }, { status: 400 })

  await supabase.from('participants').delete().eq('event_id', id)
  const { error } = await supabase.from('events').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: '認証エラー' }, { status: 403 })
  }

  const body = await req.json()
  const { id, status, title, event_date, event_end_date, location, location_url, closes_at, publishes_at, max_participants, threshold } = body

  if (!id) {
    return NextResponse.json({ error: 'id は必須です' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (event_date !== undefined && event_end_date !== undefined && !isEndAfterStart(event_date, event_end_date)) {
    return NextResponse.json({ error: 'event_end_date は event_date より後にしてください' }, { status: 400 })
  }

  if (status !== undefined) patch.status = status
  if (title !== undefined) patch.title = title
  if (event_date !== undefined) patch.event_date = event_date
  if (event_end_date !== undefined) patch.event_end_date = event_end_date
  if (location !== undefined) patch.location = location
  if (location_url !== undefined) patch.location_url = location_url
  if (closes_at !== undefined) patch.closes_at = closes_at
  if (publishes_at !== undefined) patch.publishes_at = publishes_at
  if (max_participants !== undefined) patch.max_participants = max_participants
  if (threshold !== undefined) patch.threshold = threshold

  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ event: data })
}
