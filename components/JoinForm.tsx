'use client'

import { useCallback, useState, useEffect } from 'react'
import { Event, Member, Participant } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'

const supabase = getSupabase()
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface Props {
  event: Event
}

export default function JoinForm({ event }: Props) {
  const [member, setMember] = useState<Member | null>(null)
  const [action, setAction] = useState<'join' | 'cancel' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [participation, setParticipation] = useState<Participant | null>(null)

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
        await loadParticipation(data.id)
      }
    }
    load()
  }, [event.id, loadParticipation])

  useEffect(() => {
    if (!member) return

    const channel = supabase
      .channel(`join-form:${event.id}:${member.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `event_id=eq.${event.id}` },
        () => { loadParticipation(member.id) }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [event.id, loadParticipation, member])

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

    const data = await res.json() as { error?: string; participant?: Participant; waitlist?: boolean }
    setAction(null)

    if (!res.ok) {
      setError(data.error ?? '申請に失敗しました')
      await loadParticipation(member.id)
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
      await loadParticipation(member.id)
      return
    }

    setParticipation(null)
    setMessage('キャンセルしました。')
    window.dispatchEvent(new CustomEvent('participants-changed', { detail: { eventId: event.id } }))
  }

  // 未登録
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

  // ログイン済み
  return (
    <div className="space-y-3">
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
    </div>
  )
}
