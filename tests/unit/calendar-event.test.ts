import { describe, it, expect } from 'vitest'
import { DEFAULT_EVENT_DURATION_HOURS, buildGoogleCalendarUrl, resolveEventTimes } from '@/lib/calendar-event'

describe('resolveEventTimes', () => {
  it('uses event_end_date when present', () => {
    const { start, end } = resolveEventTimes({
      event_date: '2026-08-01T10:00:00.000Z',
      event_end_date: '2026-08-01T12:30:00.000Z',
    })

    expect(start.toISOString()).toBe('2026-08-01T10:00:00.000Z')
    expect(end.toISOString()).toBe('2026-08-01T12:30:00.000Z')
  })

  it('falls back to start + DEFAULT_EVENT_DURATION_HOURS when event_end_date is null', () => {
    const { start, end } = resolveEventTimes({
      event_date: '2026-08-01T10:00:00.000Z',
      event_end_date: null,
    })

    expect(start.toISOString()).toBe('2026-08-01T10:00:00.000Z')
    expect(end.getTime() - start.getTime()).toBe(DEFAULT_EVENT_DURATION_HOURS * 60 * 60 * 1000)
    expect(end.toISOString()).toBe('2026-08-01T12:00:00.000Z')
  })

  it('correctly converts offset-form ISO strings (e.g. +09:00) to UTC', () => {
    const { start, end } = resolveEventTimes({
      event_date: '2026-08-01T19:00:00+09:00',
      event_end_date: '2026-08-01T21:00:00+09:00',
    })

    expect(start.toISOString()).toBe('2026-08-01T10:00:00.000Z')
    expect(end.toISOString()).toBe('2026-08-01T12:00:00.000Z')
  })

  it('throws when event_date is an invalid date', () => {
    expect(() =>
      resolveEventTimes({ event_date: 'not-a-date', event_end_date: null })
    ).toThrow('不正な日付です')
  })

  it('throws when event_end_date is an invalid date', () => {
    expect(() =>
      resolveEventTimes({ event_date: '2026-08-01T10:00:00.000Z', event_end_date: 'not-a-date' })
    ).toThrow('不正な日付です')
  })
})

describe('buildGoogleCalendarUrl', () => {
  const baseEvent = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'テスト大会',
    event_date: '2026-08-01T10:00:00.000Z',
    event_end_date: '2026-08-01T12:00:00.000Z',
    location: '体育館',
    location_url: null as string | null,
  }

  it('uses the Google render template base and action=TEMPLATE', () => {
    const url = new URL(buildGoogleCalendarUrl(baseEvent, { siteEventUrl: 'https://example.com/events/1' }))

    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
  })

  it('encodes dates as UTC in YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ form', () => {
    const url = new URL(buildGoogleCalendarUrl(baseEvent, { siteEventUrl: 'https://example.com/events/1' }))

    expect(url.searchParams.get('dates')).toBe('20260801T100000Z/20260801T120000Z')
  })

  it('falls back to +2h end time when event_end_date is null', () => {
    const url = new URL(
      buildGoogleCalendarUrl(
        { ...baseEvent, event_end_date: null },
        { siteEventUrl: 'https://example.com/events/1' }
      )
    )

    expect(url.searchParams.get('dates')).toBe('20260801T100000Z/20260801T120000Z')
  })

  it('lets URLSearchParams handle encoding for titles containing commas and special characters', () => {
    const url = new URL(
      buildGoogleCalendarUrl(
        { ...baseEvent, title: '練習会, 初級/中級 & 上級' },
        { siteEventUrl: 'https://example.com/events/1' }
      )
    )

    expect(url.searchParams.get('text')).toBe('練習会, 初級/中級 & 上級')
  })

  it('includes the site event URL and cancellation-note text in details', () => {
    const url = new URL(buildGoogleCalendarUrl(baseEvent, { siteEventUrl: 'https://example.com/events/1' }))
    const details = url.searchParams.get('details') ?? ''

    expect(details).toContain('https://example.com/events/1')
    expect(details).toContain('削除')
  })

  it('includes location_url guidance when present', () => {
    const url = new URL(
      buildGoogleCalendarUrl(
        { ...baseEvent, location_url: 'https://maps.example.com/x' },
        { siteEventUrl: 'https://example.com/events/1' }
      )
    )
    const details = url.searchParams.get('details') ?? ''

    expect(details).toContain('https://maps.example.com/x')
  })

  it('sets location to the event location', () => {
    const url = new URL(buildGoogleCalendarUrl(baseEvent, { siteEventUrl: 'https://example.com/events/1' }))

    expect(url.searchParams.get('location')).toBe('体育館')
  })

  it('throws when event_date is an invalid date', () => {
    expect(() =>
      buildGoogleCalendarUrl(
        { ...baseEvent, event_date: 'not-a-date' },
        { siteEventUrl: 'https://example.com/events/1' }
      )
    ).toThrow('不正な日付です')
  })
})
