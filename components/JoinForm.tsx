'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, X } from 'lucide-react'
import { Event, EventStatus, Member, Participant } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'
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
}

type JoinResponse = {
  error?: string
  participant?: Participant
  temporary_code?: string
  waitlist?: boolean
}

function guestPrefix(memberId: string) {
  return `guest:${memberId}:`
}

function getTemporaryCode(participant: Participant) {
  return participant.user_code.split(':').at(-1) ?? participant.user_code
}

function getFamilyName(memberName: string) {
  const baseName = memberName.replace(/\([^()]*\)$/, '').trim()
  return baseName.split(/\s+/)[0] || baseName
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

export default function JoinForm({ event }: Props) {
  const [member, setMember] = useState<Member | null>(null)
  const [action, setAction] = useState<'join' | 'cancel' | string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [participation, setParticipation] = useState<Participant | null>(null)
  const [guests, setGuests] = useState<Participant[]>([])
  const [guestNames, setGuestNames] = useState([''])
  const [activeCount, setActiveCount] = useState(0)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [eventStatus, setEventStatus] = useState<EventStatus>(event.status)

  const loadParticipation = useCallback(async (memberId: string) => {
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('event_id', event.id)
      .eq('member_id', memberId)
      .neq('status', 'cancelled')
      .limit(1)
      .maybeSingle()

    setParticipation((data as Participant | null) ?? null)
  }, [event.id])

  const loadGuests = useCallback(async (memberId: string) => {
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('event_id', event.id)
      .neq('status', 'cancelled')
      .like('user_code', `${guestPrefix(memberId)}%`)
      .order('created_at', { ascending: true })

    const fetchedGuests = (data as Participant[] | null) ?? []
    setGuests(fetchedGuests)
    setGuestNames(current => {
      if (current.some(name => name.trim())) return current
      if (fetchedGuests.length > 0) return []
      return current.length === 0 ? [''] : current
    })
  }, [event.id])

  const loadActiveCount = useCallback(async () => {
    const { count } = await supabase
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('status', 'active')

    setActiveCount(count ?? 0)
  }, [event.id])

  const reloadMine = useCallback(async (memberId: string) => {
    await Promise.all([loadParticipation(memberId), loadGuests(memberId), loadActiveCount()])
  }, [loadActiveCount, loadGuests, loadParticipation])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
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
    }
    load()
  }, [event.id, reloadMine])

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
    const channel = supabase
      .channel(`join-form-event:${event.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${event.id}` },
        payload => {
          const next = payload.new as Partial<Event>
          if (next.status) setEventStatus(next.status)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [event.id])

  const remainingSlots = Math.max(event.max_participants - activeCount, 0)
  const canJoin = eventStatus === 'accepting' && remainingSlots > 0
  const canAddGuest = canJoin
  const canAddGuestInput = canAddGuest && guestNames.length < remainingSlots
  const isAddingGuest = typeof action === 'string' && action.startsWith('guest:')
  const activeCountAfterSelfCancel = Math.max(
    activeCount - (participation?.status === 'active' ? 1 : 0),
    0
  )
  const shouldShowThresholdCancelWarning =
    eventStatus === 'closed' && activeCountAfterSelfCancel >= event.threshold
  const cancelConfirmDescription = shouldShowThresholdCancelWarning
    ? `参加者数が${event.threshold}人を下回るまで追加の参加申請はできません。キャンセルしてもよろしいですか？`
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
      if (current.length === 1) return ['']
      return current.filter((_, i) => i !== index)
    })
  }

  function clearGuestInput(index: number) {
    setGuestNames(current => current.filter((_, i) => i !== index))
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

    setParticipation(data.participant ?? null)
    setMessage('参加登録が完了しました。')
    await reloadMine(member.id)
    window.dispatchEvent(new CustomEvent('participants-changed', { detail: { eventId: event.id } }))
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

    setParticipation(null)
    setShowCancelConfirm(false)
    setMessage('キャンセルしました。')
    await reloadMine(member.id)
    window.dispatchEvent(new CustomEvent('participants-changed', { detail: { eventId: event.id } }))
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

    clearGuestInput(index)
    setMessage(`友達を追加しました。臨時ID: ${data.temporary_code ?? '発行済み'}`)
    await reloadMine(member.id)
    window.dispatchEvent(new CustomEvent('participants-changed', { detail: { eventId: event.id } }))
  }

  async function handleCancelGuest(guest: Participant) {
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

    setMessage(`${guest.name} さんをキャンセルしました。`)
    await reloadMine(member.id)
    window.dispatchEvent(new CustomEvent('participants-changed', { detail: { eventId: event.id } }))
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
              現在の参加者 {activeCount} / {event.max_participants}、追加可能 {remainingSlots} 名
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
