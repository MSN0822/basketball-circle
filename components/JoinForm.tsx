'use client'

import { useCallback, useState, useEffect } from 'react'
import Link from 'next/link'
import { Event, Member, Participant } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

export default function JoinForm({ event }: Props) {
  const [member, setMember] = useState<Member | null>(null)
  const [action, setAction] = useState<'join' | 'cancel' | 'guest' | string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [participation, setParticipation] = useState<Participant | null>(null)
  const [guests, setGuests] = useState<Participant[]>([])
  const [guestName, setGuestName] = useState('')

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

    setGuests((data as Participant[] | null) ?? [])
  }, [event.id])

  const reloadMine = useCallback(async (memberId: string) => {
    await Promise.all([loadParticipation(memberId), loadGuests(memberId)])
  }, [loadGuests, loadParticipation])

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

  async function handleJoin() {
    if (!member) return
    setAction('join')
    setError('')
    setMessage('')

    const res = await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: event.id, name: member.name, member_id: member.id }),
    })

    const data = await res.json() as JoinResponse
    setAction(null)

    if (!res.ok) {
      setError(data.error ?? '申請に失敗しました')
      await reloadMine(member.id)
      return
    }

    setParticipation(data.participant ?? null)
    setMessage(data.waitlist ? 'キャンセル待ちに登録しました！' : '参加登録が完了しました！')
    window.dispatchEvent(new CustomEvent('participants-changed', { detail: { eventId: event.id } }))
  }

  async function handleCancel() {
    if (!member || !participation) return
    setAction('cancel')
    setError('')
    setMessage('')

    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    setMessage('キャンセルしました。')
    window.dispatchEvent(new CustomEvent('participants-changed', { detail: { eventId: event.id } }))
  }

  async function handleAddGuest() {
    if (!member) return

    const baseGuestName = guestName.trim()
    if (!baseGuestName) {
      setError('友達の名前を入力してください')
      return
    }
    if (guests.length >= 3) {
      setError('友達の臨時ID発行は1イベント3名までです')
      return
    }

    setAction('guest')
    setError('')
    setMessage('')

    const res = await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: event.id,
        name: `${baseGuestName}（${getFamilyName(member.name)}の友達）`,
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

    setGuestName('')
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
      headers: { 'Content-Type': 'application/json' },
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
          onClick={handleCancel}
          disabled={action === 'cancel'}
          variant="destructive"
          className="w-full"
        >
          {action === 'cancel' ? '処理中...' : 'キャンセル'}
        </Button>
      ) : (
        <Button onClick={handleJoin} disabled={action === 'join'} className="w-full">
          {action === 'join' ? '処理中...' : event.status === 'accepting' ? '参加申請する' : 'キャンセル待ちに登録する'}
        </Button>
      )}

      <div className="space-y-3 rounded-md border bg-background p-3">
        <div>
          <p className="text-sm font-medium">友達を呼ぶ</p>
          <p className="text-xs text-muted-foreground">
            {participation
              ? 'このイベントだけ有効な臨時IDを3名まで発行できます。'
              : '自分が参加しない場合でも、友達の臨時IDを3名まで発行できます。'}
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            value={guestName}
            onChange={e => setGuestName(e.target.value)}
            placeholder="友達の名前"
            disabled={guests.length >= 3 || action === 'guest'}
          />
          <Button
            type="button"
            onClick={handleAddGuest}
            disabled={guests.length >= 3 || action === 'guest'}
          >
            {action === 'guest' ? '発行中...' : '追加'}
          </Button>
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

        <p className="text-xs text-muted-foreground">{guests.length} / 3 名発行済み</p>
      </div>
    </div>
  )
}
