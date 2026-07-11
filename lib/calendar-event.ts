import type { Event } from '@/lib/supabase'

export const DEFAULT_EVENT_DURATION_HOURS = 2

type CalendarEventFields = Pick<Event, 'event_date' | 'event_end_date'>

/**
 * event_end_date が未設定のイベントは、開始時刻 + DEFAULT_EVENT_DURATION_HOURS を
 * 終了時刻として扱う（暫定フォールバック。値の妥当性はまっすん確認要 / SPEC.md JOIN-22参照）。
 */
export function resolveEventTimes(event: CalendarEventFields): { start: Date; end: Date } {
  const start = new Date(event.event_date)
  const end = event.event_end_date
    ? new Date(event.event_end_date)
    : new Date(start.getTime() + DEFAULT_EVENT_DURATION_HOURS * 60 * 60 * 1000)
  return { start, end }
}

export function toUtcCalendarStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1)
  const day = pad(date.getUTCDate())
  const hours = pad(date.getUTCHours())
  const minutes = pad(date.getUTCMinutes())
  const seconds = pad(date.getUTCSeconds())
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`
}

type GoogleCalendarEventFields = Pick<
  Event,
  'id' | 'title' | 'event_date' | 'event_end_date' | 'location' | 'location_url'
>

export function buildGoogleCalendarUrl(
  event: GoogleCalendarEventFields,
  options: { siteEventUrl: string }
): string {
  const { start, end } = resolveEventTimes(event)

  const detailsLines = [
    'このリンクで追加した予定はカレンダーアプリ側のデータになります。本サイトからの削除・自動反映はできません。',
    `詳細: ${options.siteEventUrl}`,
  ]
  if (event.location_url) {
    detailsLines.push(`地図: ${event.location_url}`)
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toUtcCalendarStamp(start)}/${toUtcCalendarStamp(end)}`,
    location: event.location,
    details: detailsLines.join('\n'),
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
