import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { Member } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'

// Cookie のセッションからログイン中の会員を解決する（Server Component 用）。
// next/headers に依存するため supabase-server.ts とはファイルを分けている。
// 解決できない場合は null を返し、クライアント側のフォールバックフェッチに委ねる。
export async function getCookieMember(): Promise<Member | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null

  const cookieStore = await cookies()
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        // Server Component からは Cookie を書き込めず set が例外を投げる。
        // トークンリフレッシュの永続化は proxy.ts が担当する。
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // no-op
        }
      },
    },
  })

  // Cookie 内 JWT の未検証デコードは禁止（偽造 Cookie によるデータオラクル化を防ぐ）。
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  const { data: member } = await getServerSupabase()
    .from('members')
    .select('*')
    .eq('auth_user_id', user.id)
    .single<Member>()

  return member ?? null
}
