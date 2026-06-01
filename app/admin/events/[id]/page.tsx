'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Event, Participant } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'

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

export default function AdminEventDetailPage() {
  const params = useParams()
  const router = useRouter()
  const eventId = params.id as string

  const [event, setEvent] = useState<Event | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)

  const [confirmState, setConfirmState] = useState<{
    message: string
    onConfirm: () => Promise<void>
  } | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const loadEvent = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single<Event>()
    if (!data) {
      router.replace('/admin')
      return
    }
    setEvent(data)
    setLoading(false)
  }, [eventId, router])

  const loadParticipants = useCallback(async () => {
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('event_id', eventId)
      .neq('status', 'cancelled')
      .order('slot_number', { ascending: true })
    setParticipants(data ?? [])
  }, [eventId])

  useEffect(() => {
    // パスワード検証
    fetch('/api/admin/verify').then(res => {
      if (!res.ok) {
        router.replace('/admin')
        return
      }
      loadEvent()
      loadParticipants()
    }).catch(() => {
      router.replace('/admin')
    })
  }, [eventId, router, loadEvent, loadParticipants])

  function showConfirm(message: string, onConfirm: () => Promise<void>) {
    setConfirmState({ message, onConfirm })
  }

  function showToast(msg: string) {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 4000)
  }

  async function handleToggleStatus() {
    if (!event) return
    const newStatus =
      event.status === 'draft'
        ? 'accepting'
        : event.status === 'accepting'
          ? 'closed'
          : 'accepting'
    await fetch('/api/admin/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: event.id, status: newStatus }),
    })
    loadEvent()
  }

  function handleDelete() {
    if (!event) return
    showConfirm(
      `「${event.title}」を削除しますか？\n参加者データも全て削除されます。`,
      async () => {
        await fetch('/api/admin/events', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: event.id }),
        })
        router.replace('/admin')
      },
    )
  }

  function adminCancel(participantId: string, name: string) {
    showConfirm(`「${name}」を強制キャンセルしますか？`, async () => {
      const res = await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, admin: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(`キャンセルに失敗しました: ${data.error ?? res.status}`)
        return
      }
      await loadParticipants()
      loadEvent()
    })
  }

  if (loading || !event) {
    return <div className="max-w-lg mx-auto px-4 py-16 text-center text-muted-foreground">読み込み中...</div>
  }

  const active = participants.filter(p => p.status === 'active')
  const waitlist = participants.filter(p => p.status === 'waitlist')

  const statusLabel =
    event.status === 'draft' ? '下書き' : event.status === 'accepting' ? '受付中' : '締め切り'
  const toggleLabel =
    event.status === 'draft' ? '今すぐ公開' : event.status === 'accepting' ? '締め切る' : '再開する'

  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
      {/* 戻るリンク */}
      <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
        ← イベント管理へ戻る
      </Link>

      {/* イベント情報 */}
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <h1 className="text-xl font-bold flex-1">{event.title}</h1>
          <Badge
            variant={event.status === 'accepting' ? 'default' : 'secondary'}
            className="flex-shrink-0"
          >
            {statusLabel}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatEventDateRange(event.event_date, event.event_end_date)}
        </p>
        {event.location_url ? (
          <a
            href={event.location_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline block"
          >
            📍 {event.location}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">📍 {event.location}</p>
        )}
        {event.publishes_at && event.status === 'draft' && (
          <p className="text-xs text-blue-500">
            🕐{' '}
            {new Date(event.publishes_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}{' '}
            に自動公開
          </p>
        )}
      </div>

      {/* 操作ボタン */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleToggleStatus}>
          {toggleLabel}
        </Button>
        <Link href={`/admin/events/${event.id}/edit`}>
          <Button size="sm" variant="outline">
            編集
          </Button>
        </Link>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:bg-destructive hover:text-white ml-auto"
          onClick={handleDelete}
        >
          イベント削除
        </Button>
      </div>

      {/* 参加者リスト（下書き以外） */}
      {event.status !== 'draft' && (
        <>
          <Separator />
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-muted-foreground mb-3">
                参加者 {active.length} / {event.max_participants}
              </p>
              {active.length === 0 ? (
                <p className="text-sm text-muted-foreground">参加者はいません</p>
              ) : (
                <div className="divide-y">
                  {active.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2">
                      <span className="text-sm">
                        <span className="text-muted-foreground mr-2">{p.slot_number}.</span>
                        {p.name}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-destructive h-7 px-2"
                        onClick={() => adminCancel(p.id, p.name)}
                      >
                        強制キャンセル
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {waitlist.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-muted-foreground mb-3">
                  キャンセル待ち {waitlist.length}人
                </p>
                <div className="divide-y">
                  {waitlist.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2">
                      <span className="text-sm text-muted-foreground">
                        <span className="mr-2">待{p.slot_number}.</span>
                        {p.name}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-destructive h-7 px-2"
                        onClick={() => adminCancel(p.id, p.name)}
                      >
                        取消
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* 確認ダイアログ */}
      {confirmState && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
            <p className="text-sm whitespace-pre-wrap">{confirmState.message}</p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={confirmLoading}
                onClick={() => setConfirmState(null)}
              >
                キャンセル
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={confirmLoading}
                onClick={async () => {
                  setConfirmLoading(true)
                  await confirmState.onConfirm()
                  setConfirmLoading(false)
                  setConfirmState(null)
                }}
              >
                {confirmLoading ? '処理中...' : '実行'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* エラートースト */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground text-sm px-4 py-2 rounded-lg shadow-lg z-50 max-w-sm text-center">
          {toastMessage}
        </div>
      )}
    </main>
  )
}
