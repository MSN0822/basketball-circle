import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadSupabase() {
  vi.resetModules()
  return import('@/lib/supabase')
}

// generateUserCode のテストは lib/user-code.ts への切り出しに伴い user-code.test.ts へ移設した。
describe('lib/supabase (ブラウザ用クライアント)', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey
  })

  it('env が揃っていれば import できる', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://dummy.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon-key'

    await expect(loadSupabase()).resolves.toBeDefined()
  })

  // このモジュールは import 時に throw する設計（`export const supabase = getSupabaseClient()`）。
  // サーバー側の route handler が値として import すると env 欠落でルートごと落ちるため、
  // route / SSR からは `import type` のみに留めること（実行時依存を持たせない）。
  it('env が欠けていると import した時点で throw する', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    await expect(loadSupabase()).rejects.toThrow('Supabase環境変数が未設定です')
  })
})
