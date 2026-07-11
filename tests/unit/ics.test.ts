import { describe, it, expect } from 'vitest'
import { buildEventIcs, escapeIcsText, foldIcsLine } from '@/lib/ics'

describe('escapeIcsText', () => {
  it('escapes backslashes first so later escapes are not double-escaped', () => {
    expect(escapeIcsText('a\\b')).toBe('a\\\\b')
  })

  it('escapes semicolons', () => {
    expect(escapeIcsText('a;b')).toBe('a\\;b')
  })

  it('escapes commas', () => {
    expect(escapeIcsText('a,b')).toBe('a\\,b')
  })

  it('escapes newlines (LF, CR, CRLF) as literal \\n', () => {
    expect(escapeIcsText('a\nb')).toBe('a\\nb')
    expect(escapeIcsText('a\rb')).toBe('a\\nb')
    expect(escapeIcsText('a\r\nb')).toBe('a\\nb')
  })

  it('combines multiple escapes correctly', () => {
    expect(escapeIcsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne')
  })
})

describe('foldIcsLine', () => {
  it('does not fold lines within 75 octets', () => {
    const line = 'SUMMARY:short title'
    expect(foldIcsLine(line)).toBe(line)
  })

  it('folds lines longer than 75 octets with CRLF + single space continuation', () => {
    const longValue = 'x'.repeat(100)
    const folded = foldIcsLine(`SUMMARY:${longValue}`)
    const segments = folded.split('\r\n')

    expect(segments.length).toBeGreaterThan(1)
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startsWith(' ')).toBe(true)
    }
    // Each physical line (including the leading space on continuations) must be <=75 octets.
    for (const segment of segments) {
      expect(Buffer.byteLength(segment, 'utf8')).toBeLessThanOrEqual(75)
    }
  })

  it('does not split multi-byte UTF-8 characters across a fold boundary', () => {
    // 日本語文字は UTF-8 で3バイト。75オクテット境界をまたぐ長さの文字列で検証する。
    const longJapanese = 'あ'.repeat(60) // 180 bytes
    const line = `SUMMARY:${longJapanese}`
    const folded = foldIcsLine(line)

    // 折り返し後の各行が独立して有効なUTF-8であること（不正バイト列を作っていない）
    const segments = folded.split('\r\n')
    for (const segment of segments) {
      const withoutLeadingSpace = segment.startsWith(' ') ? segment.slice(1) : segment
      // Buffer.from(...).toString('utf8') never throws, but a broken boundary would
      // produce replacement characters (U+FFFD). Assert none appear.
      const roundTripped = Buffer.from(withoutLeadingSpace, 'utf8').toString('utf8')
      expect(roundTripped).not.toContain('�')
    }

    // 全セグメントを結合し直すと、元の文字列（エスケープなしなので変化なし）に一致する
    const rejoined = folded.replace(/\r\n /g, '')
    expect(Buffer.from(rejoined, 'utf8').toString('utf8')).toBe(line)
  })
})

describe('buildEventIcs', () => {
  const baseEvent = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'テスト大会',
    event_date: '2026-08-01T10:00:00.000Z',
    event_end_date: '2026-08-01T12:00:00.000Z',
    location: '体育館',
    location_url: null as string | null,
  }
  const now = new Date('2026-07-11T00:00:00.000Z')

  it('joins lines with CRLF and wraps content in BEGIN/END VCALENDAR', () => {
    const ics = buildEventIcs(baseEvent, { now, siteEventUrl: 'https://example.com/events/1', uidHost: 'example.com' })

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('\r\nEND:VCALENDAR\r\n')
    expect(ics).toContain('BEGIN:VEVENT\r\n')
    expect(ics).toContain('END:VEVENT\r\n')
    // METHOD:PUBLISHはiOS Safariでのカレンダー追加プロンプト起動に必要（2026-07-11実機不具合対応）。
    expect(ics).toContain('METHOD:PUBLISH')
  })

  it('includes UID built from event id and uidHost, and DTSTAMP/SUMMARY/DTSTART/DTEND', () => {
    const ics = buildEventIcs(baseEvent, { now, siteEventUrl: 'https://example.com/events/1', uidHost: 'example.com' })

    expect(ics).toContain(`UID:${baseEvent.id}@example.com`)
    expect(ics).toContain('DTSTAMP:20260711T000000Z')
    expect(ics).toContain('DTSTART:20260801T100000Z')
    expect(ics).toContain('DTEND:20260801T120000Z')
    expect(ics).toContain('SUMMARY:テスト大会')
    expect(ics).toContain('LOCATION:体育館')
  })

  it('falls back to start + 2h for DTEND when event_end_date is null', () => {
    const ics = buildEventIcs(
      { ...baseEvent, event_end_date: null },
      { now, siteEventUrl: 'https://example.com/events/1', uidHost: 'example.com' }
    )

    expect(ics).toContain('DTSTART:20260801T100000Z')
    expect(ics).toContain('DTEND:20260801T120000Z')
  })

  it('applies escaping to SUMMARY when title contains special characters', () => {
    const ics = buildEventIcs(
      { ...baseEvent, title: '練習会, 初級;上級' },
      { now, siteEventUrl: 'https://example.com/events/1', uidHost: 'example.com' }
    )

    expect(ics).toContain('SUMMARY:練習会\\, 初級\\;上級')
  })

  it('includes the site event URL and cancellation-note text in DESCRIPTION', () => {
    const ics = buildEventIcs(baseEvent, { now, siteEventUrl: 'https://example.com/events/1', uidHost: 'example.com' })
    // DESCRIPTION は75オクテットを超えるため折り返される。折り返し継続行の先頭スペースを
    // 取り除いてから検証することで、fold境界の位置に依存しないアサーションにする。
    const unfolded = ics.replace(/\r\n /g, '')

    expect(unfolded).toContain('DESCRIPTION:')
    expect(unfolded).toContain('example.com/events/1')
    expect(unfolded).toContain('削除')
  })
})
