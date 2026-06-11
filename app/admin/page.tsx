'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

export default function AdminPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')
  const [events, setEvents] = useState<Event[]>([])

  const loadEvents = useCallback(async () => {
    const res = await fetch('/api/admin/events')
    if (!res.ok) {
      setAuthed(false)
      setEvents([])
      return
    }
    const data = await res.json() as { events?: Event[] }
    setEvents(data.events ?? [])
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
    setEvents([])
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

  const drafts = events.filter(e => e.status === 'draft')
  const published = events.filter(e => e.status !== 'draft')

  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">管理者ページ</h1>
        <div className="flex gap-2">
          <Link href="/admin/create">
            <Button size="sm">+ 新規作成</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            ログアウト
          </Button>
        </div>
      </div>

      {drafts.length > 0 && (
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
        {published.length === 0 && (
          <p className="text-sm text-muted-foreground">イベントはありません</p>
        )}
        {published.map(event => (
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
