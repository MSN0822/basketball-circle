'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabase } from '@/lib/supabase-browser'

const supabase = getSupabase()
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function switchMode(next: 'login' | 'register') {
    setMode(next)
    setError('')
  }

  async function handleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError('メールアドレスまたはパスワードが違います')
      return
    }
    router.push('/')
  }

  async function handleRegister() {
    if (!name.trim()) { setError('名前を入力してください'); return }
    if (password.length < 6) { setError('パスワードは6文字以上にしてください'); return }
    setLoading(true)
    setError('')

    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })
    if (authError || !authData.user) {
      setLoading(false)
      setError(authError?.message ?? '登録に失敗しました')
      return
    }

    const res = await fetch('/api/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), auth_user_id: authData.user.id }),
    })
    setLoading(false)
    if (!res.ok) {
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
                mode === 'register' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              新規登録
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-1.5">
              <Label>お名前</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="山田 太郎"
              />
            </div>
          )}
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

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            onClick={mode === 'login' ? handleLogin : handleRegister}
            disabled={loading}
            className="w-full"
          >
            {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録する'}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
