'use client'

import { Event } from '@/lib/supabase'
import { buildGoogleCalendarUrl } from '@/lib/calendar-event'

interface Props {
  event: Pick<Event, 'id' | 'title' | 'event_date' | 'event_end_date' | 'location' | 'location_url'>
  // /events/[id] の絶対URL（呼び出し元のServer Componentがhost/protocolを解決して渡す）。
  // Googleカレンダーのdetails欄はプレーンテキストのため、相対パスだと機能しないリンクになる。
  siteEventUrl: string
}

export default function CalendarLinks({ event, siteEventUrl }: Props) {
  const googleUrl = buildGoogleCalendarUrl(event, { siteEventUrl })
  const icsUrl = `/api/events/${event.id}/ics`

  return (
    <div className="space-y-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
      <p className="font-medium">カレンダーに追加</p>
      <div className="flex flex-col gap-1">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          Googleカレンダーに追加
        </a>
        <a href={icsUrl} className="text-sm text-primary hover:underline">
          iOS標準カレンダーに追加
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        このリンクで追加した予定はカレンダーアプリ側のデータになります。本サイトからの削除・自動反映はできません。日程変更・キャンセル時はお手数ですがカレンダー側の予定も手動で削除・修正してください。
      </p>
    </div>
  )
}
