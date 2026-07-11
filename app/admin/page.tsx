'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Event } from '@/lib/supabase'
import { adminLoginErrorMessage } from '@/lib/admin-login-error'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

const LEGACY_ADMIN_KEY = 'basketball_admin_password'

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
  const sameDay =
    start.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) ===
    end.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
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

function AdminPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')
  const [eventLists, setEventLists] = useState<{ current: Event[]; archived: Event[] }>({
    current: [],
    archived: [],
  })
  const [eventsLoading, setEventsLoading] = useState(false)
  const [showArchive, setShowArchive] = useState(() => searchParams.get('archive') === '1')

  function toggleArchive() {
    const next = !showArchive
    setShowArchive(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next) {
      params.set('archive', '1')
    } else {
      params.delete('archive')
    }
    const query = params.toString()
    router.replace(query ? `/admin?${query}` : '/admin')
  }

  const loadEvents = useCallback(async () => {
    setEventsLoading(true)
    try {
      const res = await fetch('/api/admin/events?grouped=1')
      if (!res.ok) {
        setAuthed(false)
        setEventLists({ current: [], archived: [] })
        return
      }
      const data = await res.json() as { events?: Event[]; archivedEvents?: Event[] }
      setEventLists({
        current: data.events ?? [],
        archived: data.archivedEvents ?? [],
      })
    } finally {
      setEventsLoading(false)
    }
  }, [])

  useEffect(() => {
    localStorage.removeItem(LEGACY_ADMIN_KEY)
    fetch('/api/admin/verify')
      .then(res => {
        if (res.ok) {
          setAuthed(true)
          loadEvents()
        }
      })
      .catch(() => {})
  }, [loadEvents])

  async function handleLogout() {
    await fetch('/api/admin/verify', { method: 'DELETE' })
    setAuthed(false)
    setPassword('')
    setEventLists({ current: [], archived: [] })
  }

  async function handleLogin() {
    setAuthError('')
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) {
      setAuthError(adminLoginErrorMessage(res.status))
      return
    }
    setAuthed(true)
    setPassword('')
    loadEvents()
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
        <Button onClick={handleLogin} className="w-full">
          ログイン
        </Button>
      </main>
    )
  }

  const currentEvents = eventLists.current
  const drafts = currentEvents.filter(e => e.status === 'draft')
  const published = currentEvents.filter(e => e.status !== 'draft' && e.status !== 'archived')
  const listedEvents = showArchive ? eventLists.archived : published

  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-8">
      <div className="space-y-3">
        <h1 className="text-xl font-bold">{showArchive ? 'アーカイブイベント一覧' : '進行中イベント一覧'}</h1>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={toggleArchive}>
            {showArchive ? '通常一覧' : 'アーカイブ'}
          </Button>
          <Link href="/admin/create">
            <Button size="sm">+ 新規作成</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            ログアウト
          </Button>
        </div>
      </div>

      {!showArchive && drafts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">下書き</h2>
          {drafts.map(event => (
            <div
              key={event.id}
              onClick={() => router.push(`/admin/events/${event.id}`)}
              className="cursor-pointer"
            >
              <Card className="border-dashed hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{event.title}</CardTitle>
                  <CardDescription>
                    {formatEventDateRange(event.event_date, event.event_end_date)}
                  </CardDescription>
                  <p className="text-sm text-muted-foreground">📍 {event.location}</p>
                  {event.publishes_at && (
                    <p className="text-xs text-blue-500">
                      🕐{' '}
                      {new Date(event.publishes_at).toLocaleString('ja-JP', {
                        timeZone: 'Asia/Tokyo',
                      })}{' '}
                      に自動公開
                    </p>
                  )}
                </CardHeader>
              </Card>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">イベント管理</h2>
        {eventsLoading && listedEvents.length === 0 && (
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        )}
        {!eventsLoading && listedEvents.length === 0 && (
          <p className="text-sm text-muted-foreground">イベントはありません</p>
        )}
        {listedEvents.map(event => (
          <div
            key={event.id}
            onClick={() => router.push(`/admin/events/${event.id}`)}
            className="cursor-pointer"
          >
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start gap-2">
                  <CardTitle className="text-base flex-1">{event.title}</CardTitle>
                  <Badge
                    variant={event.status === 'accepting' ? 'default' : 'secondary'}
                    className="flex-shrink-0 text-xs"
                  >
                    {event.status === 'accepting' ? '受付中' : '締め切り'}
                  </Badge>
                </div>
                <CardDescription>
                  {formatEventDateRange(event.event_date, event.event_end_date)}
                </CardDescription>
                <p className="text-sm text-muted-foreground">📍 {event.location}</p>
              </CardHeader>
            </Card>
          </div>
        ))}
      </div>
    </main>
  )
}

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPageContent />
    </Suspense>
  )
}
