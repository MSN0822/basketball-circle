import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase-server'

type ResolvedSupabase =
  | { supabase: SupabaseClient; response?: never }
  | { supabase?: never; response: NextResponse }

// 生成済みクライアントはモジュール内で使い回す（リクエストごとの createClient を避ける）。
let cachedClient: SupabaseClient | null = null

// route handler のモジュールトップで getServerSupabase() を呼ぶと、env 欠落時に
// import 評価の時点で throw し、そのルート自体が起動しなくなる。
// 各ハンドラの先頭でこれを呼び、失敗時は制御された 500 を返すこと。
//
//   const resolved = resolveServerSupabase()
//   if (resolved.response) return resolved.response
//   const supabase = resolved.supabase
export function resolveServerSupabase(): ResolvedSupabase {
  if (cachedClient) return { supabase: cachedClient }

  try {
    cachedClient = getServerSupabase()
    return { supabase: cachedClient }
  } catch (error) {
    // getServerSupabase の throw メッセージは env 変数名を含むため、そのままクライアントへ返さない。
    console.error(
      '[route-supabase] Supabaseクライアントの初期化に失敗しました:',
      error instanceof Error ? error.message : error,
    )
    return { response: NextResponse.json({ error: 'サーバー設定エラーです' }, { status: 500 }) }
  }
}
