'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, X } from 'lucide-react'
import { Event, Member, PublicParticipant } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'
import { withEffectiveEventStatus } from '@/lib/event-visibility'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const supabase = getSupabase()

interface Props {
  event: Event
  initialMember: Member | null
  initialParticipation: PublicParticipant | null
  initialGuests: PublicParticipant[]
  initialActiveCount: number
}

type JoinResponse = {
  error?: string
  participant?: PublicParticipant
  temporary_code?: string
  waitlist?: boolean
}

type MineResponse = {
  error?: string
  participation?: PublicParticipant | null
  guests?: PublicParticipant[]
}

type ParticipantsChangedDetail = {
  eventId: string
  action: 'upsert' | 'remove'
  participant?: PublicParticipant
  participantId?: string
  activeDelta?: number
}

function getTemporaryCode(participant: PublicParticipant) {
  return participant.display_code ?? '発行済み'
}

function getFamilyName(memberName: string) {
  const baseName = memberName.replace(/\([^()]*\)$/, '').trim()
  return baseName.split(/\s+/)[0] || baseName
}

function notifyParticipantsChanged(detail: ParticipantsChangedDetail) {
  window.dispatchEvent(new CustomEvent('participants-changed', { detail }))
}

async function getJsonAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(data.session?.access_token
      ? { Authorization: `Bearer ${data.session.access_token}` }
      : {}),
  }
}

export default function JoinForm({ event, initialMember, initialParticipation, initialGuests, initialActiveCount }: Props) {
  const [member, setMember] = useState<Member | null>(initialMember)
  const [action, setAction] = useState<'join' | 'cancel' | string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [participation, setParticipation] = useState<PublicParticipant | null>(initialParticipation)
  const [guests, setGuests] = useState<PublicParticipant[]>(initialGuests)
  const [guestNames, setGuestNames] = useState<string[]>([])
  const [activeCount, setActiveCount] = useState(initialActiveCount)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [currentEvent, setCurrentEvent] = useState<Event>(event)
  // 申請状況が確定するまでスケルトンを表示する（SSRで解決済みなら最初から確定）
  const [statusLoaded, setStatusLoaded] = useState(initialMember !== null)

  const loadMine = useCallback(async (memberId: string) => {
    const res = await fetch(`/api/participants?event_id=${encodeURIComponent(event.id)}&member_id=${encodeURIComponent(memberId)}`, {
      headers: await getJsonAuthHeaders(),
    })
    if (!res.ok) return

    const data = await res.json().catch(() => ({})) as MineResponse
    setParticipation(data.participation ?? null)
    const fetchedGuests = data.guests ?? []
    setGuests(fetchedGuests)
    setGuestNames(current => {
      if (current.some(name => name.trim())) return current
      if (fetchedGuests.length > 0) return []
      return current
    })
  }, [event.id])

  const loadEvent = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('id', event.id)
      .single<Event>()

    if (data) setCurrentEvent(withEffectiveEventStatus(data))
  }, [event.id])

  const loadActiveCount = useCallback(async () => {
    const res = await fetch(`/api/participants?event_id=${encodeURIComponent(event.id)}`, {
      headers: await getJsonAuthHeaders(),
    })
    if (!res.ok) return

    const data = await res.json().catch(() => ({})) as { participants?: PublicParticipant[] }
    setActiveCount((data.participants ?? []).filter(participant => participant.status === 'active').length)
  }, [event.id])

  const reloadMine = useCallback(async (memberId: string) => {
    await Promise.all([loadMine(memberId), loadActiveCount(), loadEvent()])
  }, [loadActiveCount, loadEvent, loadMine])

  useEffect(() => {
    // SSR（page.tsx）で申請状況を解決済みなら初期フェッチは不要。
    // realtime 購読と15秒ポーリングが以降の更新を担保する。
    if (initialMember) return

    // フォールバック: SSRで member を解決できなかった場合（トークンリフレッシュ境界など）。
    // getSession() はローカル読みのためネットワーク往復を増やさない。
    // 実権限はサーバ側（lib/api-auth.ts）の getUser(token) 再検証が担保する。
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) return
        const { data } = await supabase
          .from('members')
          .select('*')
          .eq('auth_user_id', user.id)
          .single()
        if (data) {
          setMember(data)
          await reloadMine(data.id)
        }
      } finally {
        setStatusLoaded(true)
      }
    }
    load()
  }, [event.id, initialMember, reloadMine])

  useEffect(() => {
    if (!member) return

    const channel = supabase
      .channel(`join-form:${event.id}:${member.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `event_id=eq.${event.id}` },
        () => { reloadMine(member.id) }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [event.id, member, reloadMine])

  useEffect(() => {
    if (!member) return

    const interval = window.setInterval(() => {
      reloadMine(member.id)
    }, 15_000)
    return () => { window.clearInterval(interval) }
  }, [member, reloadMine])

  useEffect(() => {
    const channel = supabase
      .channel(`join-form-event:${event.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${event.id}` },
        payload => {
          const next = payload.new as Partial<Event>
          setCurrentEvent(current => withEffectiveEventStatus({ ...current, ...next }))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [event.id])

  const remainingSlots = Math.max(currentEvent.max_participants - activeCount, 0)
  const canJoin = currentEvent.status === 'accepting' && remainingSlots > 0
  const canAddGuest = canJoin
  const canAddGuestInput = canAddGuest && guestNames.length < remainingSlots
  const isAddingGuest = typeof action === 'string' && action.startsWith('guest:')
  const activeCountAfterSelfCancel = Math.max(
    activeCount - (participation?.status === 'active' ? 1 : 0),
    0
  )
  const shouldShowThresholdCancelWarning =
    currentEvent.status === 'closed' && activeCountAfterSelfCancel >= currentEvent.threshold
  const cancelConfirmDescription = shouldShowThresholdCancelWarning
    ? `参加者数が${currentEvent.threshold}人を下回るまで追加の参加申請はできません。キャンセルしてもよろしいですか？`
    : '参加をキャンセルしてもよろしいですか？'

  function updateGuestName(index: number, value: string) {
    setGuestNames(current => current.map((name, i) => i === index ? value : name))
  }

  function addGuestInput() {
    if (!canAddGuestInput) return
    setGuestNames(current => [...current, ''])
  }

  function removeGuestInput(index: number) {
    setGuestNames(current => {
      if (current.length === 1) return []
      return current.filter((_, i) => i !== index)
    })
  }

  function clearGuestInput(index: number) {
    setGuestNames(current => current.filter((_, i) => i !== index))
  }

  function applyActiveDelta(delta: number) {
    if (delta !== 0) setActiveCount(current => Math.max(current + delta, 0))
  }

  async function handleJoin() {
    if (!member) return
    if (!canJoin) {
      setError('現在は参加申請を受け付けていません')
      await reloadMine(member.id)
      return
    }

    setAction('join')
    setError('')
    setMessage('')

    const res = await fetch('/api/participants', {
      method: 'POST',
      headers: await getJsonAuthHeaders(),
      body: JSON.stringify({ event_id: event.id, name: member.name, member_id: member.id }),
    })

    const data = await res.json() as JoinResponse
    setAction(null)

    if (!res.ok) {
      setError(data.error ?? '参加申請に失敗しました')
      await reloadMine(member.id)
      return
    }

    const nextParticipant = data.participant ?? null
    setParticipation(nextParticipant)
    const activeDelta = nextParticipant?.status === 'active' ? 1 : 0
    applyActiveDelta(activeDelta)
    setMessage('参加登録が完了しました。')
    if (nextParticipant) {
      notifyParticipantsChanged({
        eventId: event.id,
        action: 'upsert',
        participant: nextParticipant,
        activeDelta,
      })
    }
    void reloadMine(member.id)
  }

  async function handleCancel() {
    if (!member || !participation) return
    setAction('cancel')
    setError('')
    setMessage('')

    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: await getJsonAuthHeaders(),
      body: JSON.stringify({ participant_id: participation.id, member_id: member.id }),
    })

    setAction(null)
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      setError(data.error ?? 'キャンセルに失敗しました')
      await reloadMine(member.id)
      return
    }

    const cancelled = participation
    setParticipation(null)
    setShowCancelConfirm(false)
    const activeDelta = cancelled.status === 'active' ? -1 : 0
    applyActiveDelta(activeDelta)
    setMessage('キャンセルしました。')
    notifyParticipantsChanged({
      eventId: event.id,
      action: 'remove',
      participantId: cancelled.id,
      activeDelta,
    })
    void reloadMine(member.id)
  }

  async function handleAddGuest(index: number) {
    if (!member) return

    const baseGuestName = guestNames[index]?.trim() ?? ''
    if (!baseGuestName) {
      setError('友達の名前を入力してください')
      return
    }
    if (!canAddGuest) {
      setError('定員に達しているため、友達を追加できません')
      await reloadMine(member.id)
      return
    }

    const guestAction = `guest:${index}`
    setAction(guestAction)
    setError('')
    setMessage('')

    const res = await fetch('/api/participants', {
      method: 'POST',
      headers: await getJsonAuthHeaders(),
      body: JSON.stringify({
        event_id: event.id,
        name: `${baseGuestName}(${getFamilyName(member.name)}の友達)`,
        member_id: member.id,
        guest: true,
      }),
    })

    const data = await res.json() as JoinResponse
    setAction(null)

    if (!res.ok) {
      setError(data.error ?? '友達の追加に失敗しました')
      await reloadMine(member.id)
      return
    }

    const nextGuest = data.participant ?? null
    if (nextGuest) {
      setGuests(current => [...current.filter(guest => guest.id !== nextGuest.id), nextGuest])
    }
    clearGuestInput(index)
    const activeDelta = nextGuest?.status === 'active' ? 1 : 0
    applyActiveDelta(activeDelta)
    setMessage(`友達を追加しました。臨時ID: ${data.temporary_code ?? '発行済み'}`)
    if (nextGuest) {
      notifyParticipantsChanged({
        eventId: event.id,
        action: 'upsert',
        participant: nextGuest,
        activeDelta,
      })
    }
    void reloadMine(member.id)
  }

  async function handleCancelGuest(guest: PublicParticipant) {
    if (!member) return

    setAction(guest.id)
    setError('')
    setMessage('')

    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: await getJsonAuthHeaders(),
      body: JSON.stringify({ participant_id: guest.id, member_id: member.id }),
    })

    setAction(null)
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      setError(data.error ?? '友達のキャンセルに失敗しました')
      await reloadMine(member.id)
      return
    }

    setGuests(current => current.filter(item => item.id !== guest.id))
    const activeDelta = guest.status === 'active' ? -1 : 0
    applyActiveDelta(activeDelta)
    setMessage(`${guest.name} さんをキャンセルしました。`)
    notifyParticipantsChanged({
      eventId: event.id,
      action: 'remove',
      participantId: guest.id,
      activeDelta,
    })
    void reloadMine(member.id)
  }

  if (!statusLoaded) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="参加状況を確認中">
        <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
      </div>
    )
  }

  if (!member) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          参加申請にはログインが必要です。
        </p>
        <Link href="/login">
          <Button className="w-full">ログイン / 登録して参加申請する</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
        <span className="text-muted-foreground">会員番号 </span>
        <strong>{member.member_number}</strong>
        <span className="text-muted-foreground ml-2">({member.name})</span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-green-700">{message}</p>}

      {participation ? (
        <Button
          onClick={() => setShowCancelConfirm(true)}
          disabled={action === 'cancel'}
          variant="destructive"
          className="w-full"
        >
          {action === 'cancel' ? '処理中...' : 'キャンセル'}
        </Button>
      ) : (
        <Button onClick={handleJoin} disabled={!canJoin || action === 'join'} className="w-full">
          {action === 'join' ? '処理中...' : '参加申請する'}
        </Button>
      )}

      {!participation && !canJoin && (
        <p className="text-sm text-muted-foreground">
          現在は参加申請を受け付けていません。参加済みの友達がいる場合は、この画面からキャンセルできます。
        </p>
      )}

      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>キャンセル確認</DialogTitle>
            <DialogDescription>
              {cancelConfirmDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCancelConfirm(false)}
              disabled={action === 'cancel'}
            >
              キャンセルしない
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleCancel}
              disabled={action === 'cancel'}
            >
              {action === 'cancel' ? '処理中...' : 'キャンセルする'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-3 rounded-md border bg-background p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">友達を呼ぶ</p>
            <p className="text-xs text-muted-foreground">
              自分が参加しない場合でも、空き枠の範囲で友達の臨時IDを発行できます。
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              現在の参加者 {activeCount} / {currentEvent.max_participants}、追加可能 {remainingSlots} 名
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={addGuestInput}
            disabled={!canAddGuestInput || isAddingGuest}
            aria-label="友達入力欄を追加"
            title="友達入力欄を追加"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          {guestNames.map((name, index) => {
            const guestAction = `guest:${index}`
            return (
              <div key={index} className="flex gap-2">
                <Input
                  value={name}
                  onChange={e => updateGuestName(index, e.target.value)}
                  placeholder={`友達${index + 1}の名前`}
                  disabled={!canAddGuest || isAddingGuest}
                />
                {guestNames.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => removeGuestInput(index)}
                    disabled={isAddingGuest}
                    aria-label="友達入力欄を削除"
                    title="友達入力欄を削除"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => handleAddGuest(index)}
                  disabled={!canAddGuest || !name.trim() || action === guestAction}
                >
                  {action === guestAction ? '発行中...' : '追加'}
                </Button>
              </div>
            )
          })}
        </div>

        {guests.length > 0 && (
          <div className="space-y-2">
            {guests.map(guest => (
              <div key={guest.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                <div className="min-w-0 text-sm">
                  <p className="truncate">{guest.name}</p>
                  <p className="text-xs text-muted-foreground">
                    臨時ID: {getTemporaryCode(guest)}
                    {guest.status === 'waitlist' ? ` / 待${guest.slot_number}` : ` / ${guest.slot_number}番`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCancelGuest(guest)}
                  disabled={action === guest.id}
                >
                  {action === guest.id ? '処理中...' : '取消'}
                </Button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          友達の臨時ID発行済み: {guests.length} 名
        </p>
      </div>
    </div>
  )
}
