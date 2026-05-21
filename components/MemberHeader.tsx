'use client'

import { useEffect, useState } from 'react'
import { Member } from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase-browser'

const supabase = getSupabase()
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function MemberHeader() {
  const [member, setMember] = useState<Member | null>(null)
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
      if (data) setMember(data)
    }
    load()
  }, [])

  if (!member) {
    return (
      <Link href="/login" className="text-sm text-primary hover:underline">
        ログイン / 登録
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">
        No.<strong>{member.member_number}</strong> {member.name}
      </span>
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
  )
}
