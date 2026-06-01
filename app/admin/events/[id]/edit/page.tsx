'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import PlacesInput from '@/components/PlacesInput'

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

function toLocalDatetime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function DateTimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [date, setDate] = useState(value ? value.split('T')[0] : '')
  const [hour, setHour] = useState(value ? (value.split('T')[1]?.split(':')[0] ?? '') : '')
  const [minute, setMinute] = useState(value ? (value.split('T')[1]?.split(':')[1] ?? '') : '')

  function notify(d: string, h: string, m: string) {
    if (d && h && m) onChange(`${d}T${h}:${m}`)
  }

  const selectClass = "h-8 rounded-lg border border-input bg-transparent px-2 py-1 text-sm outline-none focus:border-ring"

  function handleClear() {
    setDate(''); setHour(''); setMinute('')
    onChange('')
  }

  return (
    <div className="flex gap-2 items-center">
      <input
        type="date"
        value={date}
        onChange={e => { setDate(e.target.value); notify(e.target.value, hour, minute) }}
        className="flex-1 h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus:border-ring"
      />
      <select value={hour} onChange={e => { setHour(e.target.value); notify(date, e.target.value, minute) }} className={selectClass}>
        <option value="">時</option>
        {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <select value={minute} onChange={e => { setMinute(e.target.value); notify(date, hour, e.target.value) }} className={selectClass}>
        <option value="">分</option>
        {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      {(date || hour || minute) && (
        <button type="button" onClick={handleClear} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      )}
    </div>
  )
}

export default function AdminEditPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [ready, setReady] = useState(false)

  const [title, setTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventEndDate, setEventEndDate] = useState('')
  const [location, setLocation] = useState('')
  const [locationUrl, setLocationUrl] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [publishesAt, setPublishesAt] = useState('')
  const [maxParticipants, setMaxParticipants] = useState('35')
  const [threshold, setThreshold] = useState('30')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/verify').then(res => {
      if (!res.ok) {
        router.replace('/admin')
        return
      }

      supabase.from('events').select('*').eq('id', id).single().then(({ data }) => {
        if (!data) { router.replace('/admin'); return }
        setTitle(data.title)
        setEventDate(toLocalDatetime(data.event_date))
        setEventEndDate(toLocalDatetime(data.event_end_date ?? null))
        setLocation(data.location)
        setLocationUrl(data.location_url ?? '')
        setClosesAt(toLocalDatetime(data.closes_at))
        setPublishesAt(toLocalDatetime(data.publishes_at))
        setMaxParticipants(String(data.max_participants))
        setThreshold(String(data.threshold))
        setReady(true)
      })
    }).catch(() => {
      router.replace('/admin')
    })
  }, [id, router])

  async function handleSave() {
    if (!title || !eventDate || !eventEndDate || !location) {
      setError('タイトル・開始日時・終了日時・場所は必須です')
      return
    }

    const eventStartIso = new Date(eventDate + '+09:00').toISOString()
    const eventEndIso = new Date(eventEndDate + '+09:00').toISOString()

    if (new Date(eventEndIso).getTime() <= new Date(eventStartIso).getTime()) {
      setError('終了日時は開始日時より後にしてください')
      return
    }
    setSaving(true)
    setError('')

    const res = await fetch('/api/admin/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        title,
        event_date: eventStartIso,
        event_end_date: eventEndIso,
        location,
        location_url: locationUrl || null,
        closes_at: closesAt ? new Date(closesAt + '+09:00').toISOString() : null,
        publishes_at: publishesAt ? new Date(publishesAt + '+09:00').toISOString() : null,
        max_participants: parseInt(maxParticipants),
        threshold: parseInt(threshold),
      }),
    })

    setSaving(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? '保存に失敗しました')
      return
    }

    router.push('/admin')
  }

  if (!ready) return null

  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">イベント編集</h1>
        <Link href="/admin">
          <Button variant="outline" size="sm">← 戻る</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">イベント情報を編集</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>タイトル</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="例: 5/23(土) バスケ" />
          </div>
          <div className="space-y-1.5">
            <Label>開始日時</Label>
            <DateTimePicker value={eventDate} onChange={setEventDate} />
          </div>
          <div className="space-y-1.5">
            <Label>終了日時</Label>
            <DateTimePicker value={eventEndDate} onChange={setEventEndDate} />
          </div>
          <div className="space-y-1.5">
            <Label>場所</Label>
            <PlacesInput
              value={location}
              onChange={setLocation}
              onSelect={(name, url) => { setLocation(name); setLocationUrl(url) }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Google Maps URL <span className="text-muted-foreground text-xs">（候補選択で自動入力）</span></Label>
            <Input value={locationUrl} onChange={e => setLocationUrl(e.target.value)} placeholder="https://www.google.com/maps/..." />
          </div>
          <div className="space-y-1.5">
            <Label>予約公開日時 <span className="text-muted-foreground text-xs">（任意・下書き保存時のみ有効）</span></Label>
            <DateTimePicker value={publishesAt} onChange={setPublishesAt} />
          </div>
          <div className="space-y-1.5">
            <Label>自動締め切り日時 <span className="text-muted-foreground text-xs">（任意）</span></Label>
            <DateTimePicker value={closesAt} onChange={setClosesAt} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>定員上限</Label>
              <Input type="number" value={maxParticipants} onChange={e => setMaxParticipants(e.target.value)} />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label>繰り上げ閾値</Label>
              <Input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? '保存中...' : '保存する'}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
