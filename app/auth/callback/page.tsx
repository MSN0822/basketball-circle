'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmailOtpType, User } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase-browser'

async function ensureMember(accessToken: string, authUserId: string, name: string): Promise<boolean> {
  const res = await fetch('/api/members', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name, auth_user_id: authUserId }),
  })
  return res.ok
}

function displayNameFor(user: User): string {
  const metadataName = user.user_metadata?.display_name
  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim()
  }
  return user.email?.split('@')[0] ?? 'Member'
}

function emailOtpType(value: string | null): EmailOtpType | null {
  if (
    value === 'signup' ||
    value === 'invite' ||
    value === 'magiclink' ||
    value === 'recovery' ||
    value === 'email_change' ||
    value === 'email'
  ) {
    return value
  }
  return null
}

export default function AuthCallbackPage() {
  const router = useRouter()
  const [message, setMessage] = useState('メール確認を完了しています...')

  useEffect(() => {
    let cancelled = false

    async function completeSignup() {
      const supabase = getSupabase()
      const url = new URL(window.location.href)
      const tokenHash = url.searchParams.get('token_hash')
      const type = emailOtpType(url.searchParams.get('type'))
      let session = null

      if (tokenHash && type) {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        if (error) throw error
        session = data.session
      }

      if (!session) {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        session = data.session
      }

      if (!session?.access_token || !session.user) {
        throw new Error('メール確認後のログイン情報を取得できませんでした')
      }

      const ok = await ensureMember(session.access_token, session.user.id, displayNameFor(session.user))
      if (!ok) {
        throw new Error('会員情報の登録に失敗しました')
      }

      if (!cancelled) router.replace('/')
    }

    completeSignup().catch(error => {
      if (cancelled) return
      console.error(error)
      setMessage('メール確認に失敗しました。ログイン画面からもう一度お試しください。')
      window.setTimeout(() => router.replace('/login'), 2500)
    })

    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <main className="max-w-sm mx-auto px-4 py-16">
      <p className="text-sm text-muted-foreground">{message}</p>
    </main>
  )
}
