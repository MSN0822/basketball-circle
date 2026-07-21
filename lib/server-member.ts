import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Member } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'

const LAST_ACCESS_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000

export async function touchMemberLastAccess(member: Pick<Member, 'id' | 'last_accessed_at'>) {
  const lastAccessedAt = Date.parse(member.last_accessed_at)
  if (Number.isFinite(lastAccessedAt) && Date.now() - lastAccessedAt < LAST_ACCESS_TOUCH_INTERVAL_MS) {
    return
  }

  const { error } = await getServerSupabase()
    .from('members')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('id', member.id)

  // 失敗しても画面描画は止めない（休眠判定は365日基準なので1回の取りこぼしの影響は小さい）。
  // ただし黙って失敗し続けると休眠削除の誤判定につながるため、ログには必ず残す。
  if (error) {
    console.error('[touchMemberLastAccess] last_accessed_at の更新に失敗しました:', member.id, error.message)
  }
}

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

  const { data: member, error: memberError } = await getServerSupabase()
    .from('members')
    .select('*')
    .eq('auth_user_id', user.id)
    .single<Member>()

  // PGRST116 = 0行（会員未登録）。それ以外は DB 障害なのでログに残す。
  // ここは throw せず null を返す（未ログイン扱いにしてクライアント側フォールバックへ委ねる設計）。
  if (memberError && memberError.code !== 'PGRST116') {
    console.error('[getCookieMember] 会員情報の取得に失敗しました:', memberError.message)
  }

  if (member) {
    await touchMemberLastAccess(member)
  }

  return member ?? null
}
