import { NextRequest, NextResponse } from 'next/server'
import { Event, EventStatus } from '@/lib/supabase'
import { checkAdmin } from '@/lib/api-auth'
import { getServerSupabase } from '@/lib/supabase-server'
import { isValidUuid } from '@/lib/validators'

const supabase = getServerSupabase()
const EVENT_STATUSES: EventStatus[] = ['accepting', 'closed', 'draft']
const MAX_TITLE_LENGTH = 200
const MAX_LOCATION_LENGTH = 200
const MAX_URL_LENGTH = 2000

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

function validateStringLength(value: unknown, field: string, maxLength: number): string | null {
  if (typeof value !== 'string') return `${field} の形式が正しくありません`
  if (value.length > maxLength) return `${field} は ${maxLength} 文字以内で入力してください`
  return null
}

function validateLocationUrl(url: unknown): string | null | { error: string } {
  if (url === null || url === '' || url === undefined) return null
  if (typeof url !== 'string') return { error: 'location_url の形式が正しくありません' }
  if (url.length > MAX_URL_LENGTH) {
    return { error: `location_url は ${MAX_URL_LENGTH} 文字以内で入力してください` }
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'location_url は http または https の URL を入力してください' }
    }
  } catch {
    return { error: 'location_url の形式が正しくありません' }
  }

  return url
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

  const trimmedTitle = typeof title === 'string' ? title.trim() : ''
  const trimmedLocation = typeof location === 'string' ? location.trim() : ''

  if (!trimmedTitle || !event_date || !event_end_date || !trimmedLocation) {
    return jsonError('title, event_date, event_end_date, location は必須です')
  }

  const titleError = validateStringLength(title, 'title', MAX_TITLE_LENGTH)
  if (titleError) return jsonError(titleError)

  const locationError = validateStringLength(location, 'location', MAX_LOCATION_LENGTH)
  if (locationError) return jsonError(locationError)

  const parsedLocationUrl = validateLocationUrl(location_url)
  if (parsedLocationUrl !== null && typeof parsedLocationUrl === 'object' && parsedLocationUrl.error) {
    return jsonError(parsedLocationUrl.error)
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
      title: trimmedTitle,
      event_date: parsedStart,
      event_end_date: parsedEnd,
      location: trimmedLocation,
      location_url: parsedLocationUrl,
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
  if (!isValidUuid(id)) {
    return jsonError('id の形式が正しくありません')
  }

  const { error: participantsError } = await supabase
    .from('participants')
    .delete()
    .eq('event_id', id)
  if (participantsError) return jsonError(participantsError.message, 500)

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
  const trimmedPatchTitle = typeof title === 'string' ? title.trim() : title
  const trimmedPatchLocation = typeof location === 'string' ? location.trim() : location

  if (!id) {
    return jsonError('id は必須です')
  }
  if (!isValidUuid(id)) {
    return jsonError('id の形式が正しくありません')
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

  if (title !== undefined) {
    if (typeof trimmedPatchTitle === 'string' && !trimmedPatchTitle) return jsonError('title is required')
    const titleError = validateStringLength(title, 'title', MAX_TITLE_LENGTH)
    if (titleError) return jsonError(titleError)
  }

  if (location !== undefined) {
    if (typeof trimmedPatchLocation === 'string' && !trimmedPatchLocation) return jsonError('location is required')
    const locationError = validateStringLength(location, 'location', MAX_LOCATION_LENGTH)
    if (locationError) return jsonError(locationError)
  }

  const parsedLocationUrl = validateLocationUrl(location_url)
  if (parsedLocationUrl !== null && typeof parsedLocationUrl === 'object' && parsedLocationUrl.error) {
    return jsonError(parsedLocationUrl.error)
  }

  const nextStart = event_date === undefined ? current.event_date : parseRequiredDate(event_date, 'event_date')
  if (typeof nextStart !== 'string') return jsonError(nextStart.error)

  const nextEnd = event_end_date === undefined ? current.event_end_date : parseRequiredDate(event_end_date, 'event_end_date')
  if (!nextEnd || typeof nextEnd !== 'string') {
    const message =
      typeof nextEnd === 'object' && nextEnd !== null && 'error' in nextEnd
        ? nextEnd.error
        : 'event_end_date が正しくありません'
    return jsonError(message)
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
  if (status !== undefined) {
    patch.status = status
    // 手動で closed にしたとき → is_manual_close = true
    // 手動で accepting / draft に戻したとき → is_manual_close = false にリセット
    if (status === 'closed') patch.is_manual_close = true
    else patch.is_manual_close = false
  }
  if (title !== undefined) patch.title = trimmedPatchTitle
  if (event_date !== undefined) patch.event_date = nextStart
  if (event_end_date !== undefined) patch.event_end_date = nextEnd
  if (location !== undefined) patch.location = trimmedPatchLocation
  if (location_url !== undefined) patch.location_url = parsedLocationUrl
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
