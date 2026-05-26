'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase, Event, Participant } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'

const ADMIN_KEY = 'basketball_admin_password'

function formatEventDateRange(startStr: string, endStr: string | null): string {
  const start = new Date(startStr)
  const startText = start.toLocaleString('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })

  if (!endStr) return startText

  const end = new Date(endStr)
  const sameDay = start.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) === end.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const endText = end.toLocaleString('ja-JP', {
    month: sameDay ? undefined : 'long',
    day: sameDay ? undefined : 'numeric',
    weekday: sameDay ? undefined : 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })

  return `${startText} - ${endText}`
}

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')
  const [events, setEvents] = useState<Event[]>([])
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)
  const [participantsMap, setParticipantsMap] = useState<Record<string, Participant[]>>({})

  const loadEvents = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('event_date', { ascending: true })
    if (data) setEvents(data)
  }, [])

  const verifyAndLoad = useCallback(async (pwd: string) => {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    })
    if (res.ok) {
      setAuthed(true)
      loadEvents()
    }
  }, [loadEvents])

  useEffect(() => {
    const saved = localStorage.getItem(ADMIN_KEY)
    if (saved) {
      queueMicrotask(() => {
        setPassword(saved)
        verifyAndLoad(saved)
      })
    }
  }, [verifyAndLoad])

  function handleLogout() {
    localStorage.removeItem(ADMIN_KEY)
    setAuthed(false)
    setPassword('')
    setEvents([])
    setExpandedEventId(null)
  }

  async function handleLogin() {
    setAuthError('')
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) {
      setAuthError('パスワードが違います')
      return
    }
    localStorage.setItem(ADMIN_KEY, password)
    setAuthed(true)
    loadEvents()
  }

  async function handleDelete(event: Event) {
    if (!confirm(`「${event.title}」を削除しますか？参加者データも全て削除されます。`)) return
    await fetch('/api/admin/events', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
      body: JSON.stringify({ id: event.id }),
    })
    loadEvents()
  }

  async function toggleStatus(event: Event) {
    const newStatus = event.status === 'draft' ? 'accepting' : event.status === 'accepting' ? 'closed' : 'accepting'
    await fetch('/api/admin/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
      body: JSON.stringify({ id: event.id, status: newStatus }),
    })
    loadEvents()
  }

  async function toggleExpand(eventId: string) {
    if (expandedEventId === eventId) {
      setExpandedEventId(null)
      return
    }
    setExpandedEventId(eventId)
    if (!participantsMap[eventId]) {
      await loadParticipants(eventId)
    }
  }

  async function loadParticipants(eventId: string) {
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('event_id', eventId)
      .neq('status', 'cancelled')
      .order('slot_number', { ascending: true })
    setParticipantsMap(prev => ({ ...prev, [eventId]: data ?? [] }))
  }

  async function adminCancel(participantId: string, eventId: string, name: string) {
    if (!confirm(`「${name}」を強制キャンセルしますか？`)) return
    await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_id: participantId, user_code: password, admin: true }),
    })
    await loadParticipants(eventId)
  }

  if (!authed) {
    return (
      <main className="max-w-sm mx-auto px-4 py-16 space-y-4">
        <h1 className="text-xl font-bold">管理者ログイン</h1>
        <div className="space-y-1.5">
          <Label htmlFor="pw">管理者パスワード</Label>
          <Input
            id="pw"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
        </div>
        {authError && <p className="text-sm text-destructive">{authError}</p>}
        <Button onClick={handleLogin} className="w-full">ログイン</Button>
      </main>
    )
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">管理者ページ</h1>
        <Button variant="outline" size="sm" onClick={handleLogout}>ログアウト</Button>
      </div>

      {/* 下書き */}
      {events.filter(e => e.status === 'draft').length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-muted-foreground">下書き</h2>
          {events.filter(e => e.status === 'draft').map(event => (
            <Card key={event.id} className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">{event.title}</CardTitle>
                <CardDescription>
                  {formatEventDateRange(event.event_date, event.event_end_date)}
                </CardDescription>
                {event.location_url ? (
                  <a href={event.location_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                    📍 {event.location}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">📍 {event.location}</p>
                )}
                {event.publishes_at && (
                  <p className="text-xs text-blue-500">
                    🕐 {new Date(event.publishes_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} に自動公開
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleStatus(event)}>
                    今すぐ公開
                  </Button>
                  <Link href={`/admin/events/${event.id}/edit`}>
                    <Button size="sm" variant="outline">編集</Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive hover:text-white ml-auto"
                    onClick={() => handleDelete(event)}
                  >
                    削除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* イベント一覧・フェーズ管理 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">イベント管理</h2>
          <Link href="/admin/create">
            <Button size="sm">+ 新規作成</Button>
          </Link>
        </div>
        {events.filter(e => e.status !== 'draft').map(event => {
          const ps = participantsMap[event.id] ?? []
          const active = ps.filter(p => p.status === 'active')
          const waitlist = ps.filter(p => p.status === 'waitlist')
          const isExpanded = expandedEventId === event.id

          return (
            <Card key={event.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{event.title}</CardTitle>
                  <Badge variant={event.status === 'accepting' ? 'default' : 'secondary'} className="flex-shrink-0">
                    {event.status === 'accepting' ? '受付中' : '締め切り'}
                  </Badge>
                </div>
                <CardDescription>
                  {formatEventDateRange(event.event_date, event.event_end_date)}
                </CardDescription>
                {event.location_url ? (
                  <a href={event.location_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                    📍 {event.location}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">📍 {event.location}</p>
                )}
              </CardHeader>
              <CardContent>
                {/* 操作ボタン */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleStatus(event)}>
                    {event.status === 'accepting' ? '締め切る' : '再開する'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleExpand(event.id)}>
                    {isExpanded ? '▲ 参加者を閉じる' : '▼ 参加者を見る'}
                  </Button>
                  <Link href={`/admin/events/${event.id}/edit`}>
                    <Button size="sm" variant="outline">編集</Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive hover:text-white ml-auto"
                    onClick={() => handleDelete(event)}
                  >
                    削除
                  </Button>
                </div>

                {/* 参加者リスト（展開時） */}
                {isExpanded && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">
                          参加者 {active.length} / {event.max_participants}
                        </p>
                        {active.length === 0 && (
                          <p className="text-xs text-muted-foreground">なし</p>
                        )}
                        {active.map(p => (
                          <div key={p.id} className="flex items-center justify-between py-1">
                            <span className="text-sm">
                              <span className="text-muted-foreground mr-2">{p.slot_number}.</span>
                              {p.name}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs text-destructive h-6 px-2"
                              onClick={() => adminCancel(p.id, event.id, p.name)}
                            >
                              強制キャンセル
                            </Button>
                          </div>
                        ))}
                      </div>
                      {waitlist.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2">
                            キャンセル待ち {waitlist.length}人
                          </p>
                          {waitlist.map(p => (
                            <div key={p.id} className="flex items-center justify-between py-1">
                              <span className="text-sm text-muted-foreground">
                                <span className="mr-2">待{p.slot_number}.</span>
                                {p.name}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs text-destructive h-6 px-2"
                                onClick={() => adminCancel(p.id, event.id, p.name)}
                              >
                                取消
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </main>
  )
}
