'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabase } from '@/lib/supabase-browser'
import { getSignupErrorMessage } from '@/lib/signup-email-error'

const supabase = getSupabase()
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

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

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login')
  const [pendingRegistration, setPendingRegistration] = useState<{
    email: string
    displayName: string
  } | null>(null)
  const [lastName, setLastName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function switchMode(next: 'login' | 'register') {
    setMode(next)
    setError('')
    setNotice('')
    setVerificationCode('')
    setPendingRegistration(null)
  }

  async function handleLogin() {
    setLoading(true)
    setError('')
    setNotice('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message.includes('Email not confirmed')
        ? 'メール確認が完了していません。新規登録タブから同じメールアドレスとパスワードで再登録すると、確認コードを再送できます'
        : 'メールアドレスまたはパスワードが違います')
      return
    }
    const session = data.session
    const user = data.user
    if (session?.access_token && user) {
      const fallbackName =
        typeof user.user_metadata?.display_name === 'string' && user.user_metadata.display_name.trim()
          ? user.user_metadata.display_name.trim()
          : (user.email?.split('@')[0] ?? 'Member')
      const ok = await ensureMember(session.access_token, user.id, fallbackName)
      if (!ok) {
        setError('会員情報の取得に失敗しました。時間をおいて再度ログインしてください')
        return
      }
    }
    router.push('/')
  }

  async function handleRegister() {
    const familyName = lastName.trim()
    const givenName = firstName.trim()
    const nick = nickname.trim()

    if (!familyName || !givenName) {
      setError('姓と名を入力してください')
      return
    }
    if (password.length < 6) {
      setError('パスワードは6文字以上にしてください')
      return
    }

    const displayName = `${familyName} ${givenName}${nick ? `(${nick})` : ''}`

    setLoading(true)
    setError('')
    setNotice('')

    const normalizedEmail = email.trim()
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          display_name: displayName,
        },
      },
    })
    if (authError) {
      setLoading(false)
      setError(getSignupErrorMessage(authError))
      return
    }

    if (authData.session?.access_token && authData.user) {
      const ok = await ensureMember(authData.session.access_token, authData.user.id, displayName)
      setLoading(false)
      if (!ok) {
        setError('会員情報の登録に失敗しました')
        return
      }
      router.push('/')
      return
    }

    // 確認済みの既存メールへの signUp は error も session も返さず、identities が
    // 空のダミー user だけが返る（メールは送信されない）
    if (authData.user && authData.user.identities?.length === 0) {
      setLoading(false)
      setError('このメールアドレスは登録済みです。ログインタブからお進みください')
      return
    }

    setLoading(false)
    setPendingRegistration({ email: normalizedEmail, displayName })
    setVerificationCode('')
    setNotice(
      '確認コードを送信しました。メールが届いたら「コード入力へ進む」から登録を完了してください。届かない場合は、1時間ほど空けてからもう一度送信してください。',
    )
  }

  async function handleVerifyCode() {
    if (!pendingRegistration) return
    const token = verificationCode.trim()
    if (!/^\d{6}$/.test(token)) {
      setError('6桁の確認コードを入力してください')
      return
    }

    setLoading(true)
    setError('')

    let { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: pendingRegistration.email,
      token,
      type: 'signup',
    })
    if (verifyError) {
      const retry = await supabase.auth.verifyOtp({
        email: pendingRegistration.email,
        token,
        type: 'email',
      })
      data = retry.data
      verifyError = retry.error
    }

    if (verifyError || !data.session?.access_token || !data.user) {
      setLoading(false)
      setError('確認コードが正しくないか、有効期限が切れています')
      return
    }

    const ok = await ensureMember(data.session.access_token, data.user.id, pendingRegistration.displayName)
    setLoading(false)
    if (!ok) {
      setError('会員情報の登録に失敗しました')
      return
    }

    router.push('/')
  }

  return (
    <main className="max-w-sm mx-auto px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-center text-lg">バスケサークル</CardTitle>
          <div className="flex border rounded-md overflow-hidden mt-3">
            <button
              onClick={() => switchMode('login')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === 'login' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              ログイン
            </button>
            <button
              onClick={() => switchMode('register')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === 'register' || mode === 'verify' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              新規登録
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === 'verify' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {pendingRegistration?.email} に届いた6桁の確認コードを入力してください。
              </p>
              <div className="space-y-1.5">
                <Label>確認コード</Label>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={verificationCode}
                  onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && handleVerifyCode()}
                  placeholder="123456"
                />
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>姓</Label>
                  <Input
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder="山田"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>名</Label>
                  <Input
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="太郎"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>
                  ニックネーム <span className="text-muted-foreground text-xs">任意</span>
                </Label>
                <Input
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  placeholder="たろちゃん"
                />
              </div>
            </div>
          )}
          {mode !== 'verify' && (
            <>
              <div className="space-y-1.5">
                <Label>メールアドレス</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>パスワード</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? '6文字以上' : ''}
                  onKeyDown={e => e.key === 'Enter' && (mode === 'login' ? handleLogin() : handleRegister())}
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

          {mode === 'register' && pendingRegistration && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError('')
                setNotice('')
                setMode('verify')
              }}
              className="w-full"
            >
              コード入力へ進む
            </Button>
          )}

          <Button
            onClick={mode === 'login' ? handleLogin : mode === 'register' ? handleRegister : handleVerifyCode}
            disabled={loading}
            className="w-full"
          >
            {loading ? '処理中...' : mode === 'login' ? 'ログイン' : mode === 'register' ? '確認コードを送る' : '登録を完了する'}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
