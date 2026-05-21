'use client'

import { useEffect, useState } from 'react'
import { supabase, Participant, Event, Member } from '@/lib/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Props {
  event: Event
  initialParticipants: Participant[]
}

export default function ParticipantList({ event, initialParticipants }: Props) {
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants)
  const [member, setMember] = useState<Member | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('members')
        .select('*')
        .eq('auth_user_id', user.id)
        .single()
      if (data) setMember(data)
    }
    load()
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel(`participants:${event.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `event_id=eq.${event.id}` },
        () => {
          supabase
            .from('participants')
            .select('*')
            .eq('event_id', event.id)
            .neq('status', 'cancelled')
            .order('slot_number', { ascending: true })
            .then(({ data }) => {
              if (data) setParticipants(data)
            })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [event.id])

  async function handleCancel(p: Participant) {
    if (!member) return
    setCancelling(p.id)

    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_id: p.id, member_id: member.id }),
    })

    setCancelling(null)
    if (!res.ok) {
      const data = await res.json()
      alert(data.error ?? 'キャンセルに失敗しました')
    }
  }

  const active = participants.filter(p => p.status === 'active')
  const waitlist = participants.filter(p => p.status === 'waitlist')

  const myParticipation = member
    ? participants.find(p => p.member_id === member.id)
    : null

  return (
    <div className="space-y-6">
      {/* 自分の参加状況 */}
      {myParticipation && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-800">
              {myParticipation.status === 'active'
                ? `✅ 参加中（${myParticipation.slot_number}番）`
                : `⏳ キャンセル待ち（待${myParticipation.slot_number}番）`}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive hover:text-white"
            disabled={cancelling === myParticipation.id}
            onClick={() => handleCancel(myParticipation)}
          >
            {cancelling === myParticipation.id ? '処理中...' : 'キャンセル'}
          </Button>
        </div>
      )}

      {/* 参加者リスト */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-semibold text-lg">参加者</h2>
          <Badge variant={active.length >= event.max_participants ? 'destructive' : 'secondary'}>
            {active.length} / {event.max_participants}
          </Badge>
        </div>
        <div className="space-y-1">
          {active.map(p => (
            <div
              key={p.id}
              className={`flex items-center justify-between px-3 py-2 rounded-md ${
                member && p.member_id === member.id ? 'bg-blue-50 border border-blue-200' : 'bg-muted/50'
              }`}
            >
              <span className="text-sm">
                <span className="text-muted-foreground mr-2">{p.slot_number}.</span>
                {p.name}
                {member && p.member_id === member.id && (
                  <span className="ml-2 text-xs text-blue-600">（自分）</span>
                )}
              </span>
            </div>
          ))}
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground px-3">まだ参加者がいません</p>
          )}
        </div>
      </div>

      {/* キャンセル待ちリスト */}
      {waitlist.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-lg">キャンセル待ち</h2>
            <Badge variant="outline">{waitlist.length}人</Badge>
          </div>
          <div className="space-y-1">
            {waitlist.map(p => (
              <div
                key={p.id}
                className={`flex items-center px-3 py-2 rounded-md ${
                  member && p.member_id === member.id ? 'bg-blue-50 border border-blue-200' : 'bg-muted/30'
                }`}
              >
                <span className="text-sm text-muted-foreground">
                  <span className="mr-2">待{p.slot_number}.</span>
                  {p.name}
                  {member && p.member_id === member.id && (
                    <span className="ml-2 text-xs text-blue-600">（自分）</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
