import type { Event } from '@/lib/supabase'
import { resolveEventTimes, toUtcCalendarStamp } from '@/lib/calendar-event'

const ICS_LINE_MAX_OCTETS = 75

/**
 * RFC5545 TEXT値のエスケープ。バックスラッシュを最初に処理しないと
 * 後続の置換で生成した \n 等を再エスケープしてしまうため順序に注意。
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * RFC5545 3.1 の行折り（75オクテット制限）。
 * UTF-8のマルチバイト文字境界（継続バイト = 0x80-0xBF）の途中で
 * 切らないよう、切断候補位置をバイト単位で後退させながら探す。
 */
export function foldIcsLine(line: string): string {
  const buffer = Buffer.from(line, 'utf8')
  if (buffer.length <= ICS_LINE_MAX_OCTETS) return line

  const segments: string[] = []
  let offset = 0
  let isFirstSegment = true

  while (offset < buffer.length) {
    // 折り返し行（先頭に半角スペース1つ）はその分だけ実効上限が1バイト減る
    const limit = isFirstSegment ? ICS_LINE_MAX_OCTETS : ICS_LINE_MAX_OCTETS - 1
    let end = Math.min(offset + limit, buffer.length)

    // UTF-8継続バイト（0x80-0xBF、上位2bitが10）の途中では切らない
    while (end > offset && (buffer[end] & 0xc0) === 0x80) {
      end -= 1
    }

    segments.push(buffer.subarray(offset, end).toString('utf8'))
    offset = end
    isFirstSegment = false
  }

  return segments.map((segment, index) => (index === 0 ? segment : ` ${segment}`)).join('\r\n')
}

function buildIcsLine(name: string, value: string): string {
  return foldIcsLine(`${name}:${escapeIcsText(value)}`)
}

type IcsEventFields = Pick<
  Event,
  'id' | 'title' | 'event_date' | 'event_end_date' | 'location' | 'location_url'
>

export function buildEventIcs(
  event: IcsEventFields,
  options: { now?: Date; siteEventUrl: string; uidHost: string }
): string {
  const now = options.now ?? new Date()
  const { start, end } = resolveEventTimes(event)

  const descriptionLines = [
    'このリンクで追加した予定はカレンダーアプリ側のデータになります。本サイトからの削除・自動反映はできません。',
    '日程変更・キャンセル時はお手数ですがカレンダー側の予定も手動で削除・修正してください。',
    `詳細: ${options.siteEventUrl}`,
  ]
  if (event.location_url) {
    descriptionLines.push(`地図: ${event.location_url}`)
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//basketball-circle//JA',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    buildIcsLine('UID', `${event.id}@${options.uidHost}`),
    buildIcsLine('SEQUENCE', '0'),
    buildIcsLine('STATUS', 'CONFIRMED'),
    buildIcsLine('DTSTAMP', toUtcCalendarStamp(now)),
    buildIcsLine('DTSTART', toUtcCalendarStamp(start)),
    buildIcsLine('DTEND', toUtcCalendarStamp(end)),
    buildIcsLine('SUMMARY', event.title),
    buildIcsLine('LOCATION', event.location),
    buildIcsLine('DESCRIPTION', descriptionLines.join('\n')),
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lines.join('\r\n') + '\r\n'
}
