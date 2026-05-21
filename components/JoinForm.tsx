'use client'

import { useState, useEffect } from 'react'
import { supabase, Event, Member } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface Props {
  event: Event
}

export default function JoinForm({ event }: Props) {
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<'active' | 'waitlist' | null>(null)

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

  async function handleJoin() {
    if (!member) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: event.id, name: member.name, member_id: member.id }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? '申請に失敗しました')
      return
    }

    setDone(data.waitlist ? 'waitlist' : 'active')
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

  // 申請完了
  if (done) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1">
        <p className="font-semibold text-green-800">
          {done === 'waitlist' ? 'キャンセル待ちに登録しました！' : '参加登録が完了しました！'}
        </p>
        <p className="text-sm text-green-700">
          会員番号 <strong>{member.member_number}</strong>（{member.name}）で登録済みです。
        </p>
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
        <button
          onClick={async () => { await supabase.auth.signOut(); setMember(null) }}
          className="ml-3 text-xs text-muted-foreground hover:text-foreground underline"
        >
          ログアウト
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleJoin} disabled={loading} className="w-full">
        {loading ? '処理中...' : event.status === 'accepting' ? '参加申請する' : 'キャンセル待ちに登録する'}
      </Button>
    </div>
  )
}
