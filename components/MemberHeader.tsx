'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Member } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const supabase = getSupabase()

function parseDisplayName(name: string) {
  const match = name.match(/^(.*?)(?:\(([^()]*)\))?$/)
  if (!match) return { baseName: name.trim(), nickname: '' }

  return {
    baseName: match[1].trim(),
    nickname: match[2] ?? '',
  }
}

export default function MemberHeader() {
  const [member, setMember] = useState<Member | null>(null)
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

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
        setNickname(parseDisplayName(data.name).nickname)
      }
    }
    load()
  }, [])

  async function saveNickname() {
    if (!member) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { baseName } = parseDisplayName(member.name)
    const nextNickname = nickname.trim()
    const nextName = nextNickname ? `${baseName}(${nextNickname})` : baseName

    setSaving(true)
    setError('')

    const { data, error: memberError } = await supabase
      .from('members')
      .update({ name: nextName })
      .eq('id', member.id)
      .eq('auth_user_id', user.id)
      .select('*')
      .single()

    if (memberError || !data) {
      setSaving(false)
      setError('ニックネームの保存に失敗しました')
      return
    }

    const { error: participantsError } = await supabase
      .from('participants')
      .update({ name: nextName })
      .eq('member_id', member.id)
      .in('status', ['active', 'waitlist'])

    setSaving(false)
    if (participantsError) {
      setError('参加者名の更新に失敗しました')
      return
    }

    setMember(data)
    setEditing(false)
    window.dispatchEvent(new CustomEvent('participants-changed'))
    router.refresh()
  }

  if (!member) {
    return (
      <Link href="/login" className="text-sm text-primary hover:underline">
        ログイン / 登録
      </Link>
    )
  }

  return (
    <div className="w-full space-y-2 sm:w-auto">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-muted-foreground">
          No.<strong>{member.member_number}</strong> {member.name}
        </span>
        <button
          onClick={() => {
            setNickname(parseDisplayName(member.name).nickname)
            setEditing(value => !value)
            setError('')
          }}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          ニックネーム変更
        </button>
        <button
          onClick={async () => {
            await supabase.auth.signOut()
            setMember(null)
            router.refresh()
          }}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          ログアウト
        </button>
      </div>

      {editing && (
        <div className="ml-auto flex max-w-xs flex-col gap-2 rounded-md border bg-background p-3">
          <Input
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            placeholder="ニックネーム"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setNickname(parseDisplayName(member.name).nickname)
                setEditing(false)
                setError('')
              }}
              disabled={saving}
            >
              キャンセル
            </Button>
            <Button size="sm" onClick={saveNickname} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
