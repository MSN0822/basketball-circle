import { NextRequest, NextResponse } from 'next/server'
import { Event, EventStatus } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'

const supabase = getServerSupabase()
const EVENT_STATUSES: EventStatus[] = ['accepting', 'closed', 'draft']

function checkAdmin(req: NextRequest): boolean {
  const password = req.headers.get('x-admin-password')
  return Boolean(process.env.ADMIN_PASSWORD) && password === process.env.ADMIN_PASSWORD
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

function parseRequiredDate(value: unknown, field: string): string | { error: string } {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    return { error: `${field} が正しくありません` }
  }
  return value
}

function parseNullableDate(value: unknown, field: string): string | null | { error: string } {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    return { error: `${field} が正しくありません` }
  }
  return value
}

function parsePositiveInteger(value: unknown, field: string): number | { error: string } {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    return { error: `${field} は1以上の整数で入力してください` }
  }
  return numberValue
}

function validateCapacity(maxParticipants: number, threshold: number): string | null {
  if (threshold > maxParticipants) {
    return '閾値は定員以下にしてください'
  }
  return null
}

function isEndAfterStart(start: string, end: string): boolean {
  return new Date(end).getTime() > new Date(start).getTime()
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) {
    return jsonError('認証エラー', 403)
  }

  const body = await req.json()
  const {
    title,
    event_date,
    event_end_date,
    location,
    location_url = null,
    closes_at = null,
    publishes_at = null,
    max_participants = 35,
    threshold = 30,
    status = 'accepting',
  } = body

  if (!title || !event_date || !event_end_date || !location) {
    return jsonError('title, event_date, event_end_date, location は必須です')
  }

  if (!EVENT_STATUSES.includes(status)) {
    return jsonError('status が正しくありません')
  }

  const parsedStart = parseRequiredDate(event_date, 'event_date')
  if (typeof parsedStart !== 'string') return jsonError(parsedStart.error)

  const parsedEnd = parseRequiredDate(event_end_date, 'event_end_date')
  if (typeof parsedEnd !== 'string') return jsonError(parsedEnd.error)

  if (!isEndAfterStart(parsedStart, parsedEnd)) {
    return jsonError('event_end_date は event_date より後にしてください')
  }

  const parsedClosesAt = parseNullableDate(closes_at, 'closes_at')
  if (typeof parsedClosesAt === 'object' && parsedClosesAt?.error) return jsonError(parsedClosesAt.error)

  const parsedPublishesAt = parseNullableDate(publishes_at, 'publishes_at')
  if (typeof parsedPublishesAt === 'object' && parsedPublishesAt?.error) return jsonError(parsedPublishesAt.error)

  const parsedMaxParticipants = parsePositiveInteger(max_participants, 'max_participants')
  if (typeof parsedMaxParticipants !== 'number') return jsonError(parsedMaxParticipants.error)

  const parsedThreshold = parsePositiveInteger(threshold, 'threshold')
  if (typeof parsedThreshold !== 'number') return jsonError(parsedThreshold.error)

  const capacityError = validateCapacity(parsedMaxParticipants, parsedThreshold)
  if (capacityError) return jsonError(capacityError)

  const { data, error } = await supabase
    .from('events')
    .insert({
      title,
      event_date: parsedStart,
      event_end_date: parsedEnd,
      location,
      location_url,
      closes_at: parsedClosesAt,
      publishes_at: parsedPublishesAt,
      max_participants: parsedMaxParticipants,
      threshold: parsedThreshold,
      status,
    })
    .select()
    .single()

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ event: data })
}

export async function DELETE(req: NextRequest) {
  if (!checkAdmin(req)) {
    return jsonError('認証エラー', 403)
  }

  const { id } = await req.json()
  if (!id) return jsonError('id は必須です')

  await supabase.from('participants').delete().eq('event_id', id)
  const { error } = await supabase.from('events').delete().eq('id', id)

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  if (!checkAdmin(req)) {
    return jsonError('認証エラー', 403)
  }

  const body = await req.json()
  const { id, status, title, event_date, event_end_date, location, location_url, closes_at, publishes_at, max_participants, threshold } = body

  if (!id) {
    return jsonError('id は必須です')
  }

  const { data: current, error: currentError } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .single<Event>()

  if (currentError || !current) {
    return jsonError('イベントが見つかりません', 404)
  }

  if (status !== undefined && !EVENT_STATUSES.includes(status)) {
    return jsonError('status が正しくありません')
  }

  const nextStart = event_date === undefined ? current.event_date : parseRequiredDate(event_date, 'event_date')
  if (typeof nextStart !== 'string') return jsonError(nextStart.error)

  const nextEnd = event_end_date === undefined ? current.event_end_date : parseRequiredDate(event_end_date, 'event_end_date')
  if (!nextEnd || typeof nextEnd !== 'string') {
    return jsonError(typeof nextEnd === 'object' && nextEnd?.error ? nextEnd.error : 'event_end_date が正しくありません')
  }

  if (!isEndAfterStart(nextStart, nextEnd)) {
    return jsonError('event_end_date は event_date より後にしてください')
  }

  const nextMax = max_participants === undefined
    ? current.max_participants
    : parsePositiveInteger(max_participants, 'max_participants')
  if (typeof nextMax !== 'number') return jsonError(nextMax.error)

  const nextThreshold = threshold === undefined
    ? current.threshold
    : parsePositiveInteger(threshold, 'threshold')
  if (typeof nextThreshold !== 'number') return jsonError(nextThreshold.error)

  const capacityError = validateCapacity(nextMax, nextThreshold)
  if (capacityError) return jsonError(capacityError)

  const patch: Record<string, unknown> = {}
  if (status !== undefined) patch.status = status
  if (title !== undefined) patch.title = title
  if (event_date !== undefined) patch.event_date = nextStart
  if (event_end_date !== undefined) patch.event_end_date = nextEnd
  if (location !== undefined) patch.location = location
  if (location_url !== undefined) patch.location_url = location_url
  if (closes_at !== undefined) {
    const parsed = parseNullableDate(closes_at, 'closes_at')
    if (typeof parsed === 'object' && parsed?.error) return jsonError(parsed.error)
    patch.closes_at = parsed
  }
  if (publishes_at !== undefined) {
    const parsed = parseNullableDate(publishes_at, 'publishes_at')
    if (typeof parsed === 'object' && parsed?.error) return jsonError(parsed.error)
    patch.publishes_at = parsed
  }
  if (max_participants !== undefined) patch.max_participants = nextMax
  if (threshold !== undefined) patch.threshold = nextThreshold

  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ event: data })
}
