'use client'

import { Event } from '@/lib/supabase'
import { buildGoogleCalendarUrl } from '@/lib/calendar-event'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  event: Pick<Event, 'id' | 'title' | 'event_date' | 'event_end_date' | 'location' | 'location_url'>
  // /events/[id] の絶対URL（呼び出し元のServer Componentがhost/protocolを解決して渡す）。
  // Googleカレンダーのdetails欄はプレーンテキストのため、相対パスだと機能しないリンクになる。
  siteEventUrl: string
}

export default function CalendarLinks({ event, siteEventUrl }: Props) {
  let googleUrl: string
  try {
    googleUrl = buildGoogleCalendarUrl(event, { siteEventUrl })
  } catch {
    // 不正な日付のイベントではカレンダーリンクブロック自体を非表示にする
    return null
  }
  const icsUrl = `/api/events/${event.id}/ics`
  // タップ領域を広げ押し間違いを減らすため、テキストリンクではなくボタン風の横並びにする（2026-07-11 まっすんフィードバック対応）。
  const linkClass = cn(buttonVariants({ variant: 'outline', size: 'default' }), 'flex-1')

  return (
    <div className="space-y-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
      <p className="font-medium">カレンダーに追加</p>
      <div className="flex flex-row gap-2">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          Googleカレンダー
        </a>
        <a href={icsUrl} className={linkClass}>
          iOS標準カレンダー
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        iOS標準カレンダーはタップで反応しない場合があります。その際はリンクを長押しし、「プレビュー」からカレンダーに追加してください。
      </p>
      <p className="text-xs text-muted-foreground">
        このリンクで追加した予定はカレンダーアプリ側のデータになります。本サイトからの削除・自動反映はできません。日程変更・キャンセル時はお手数ですがカレンダー側の予定も手動で削除・修正してください。
      </p>
    </div>
  )
}
