import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadSupabase() {
  vi.resetModules()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://dummy.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon-key'
  return import('@/lib/supabase')
}

describe('generateUserCode', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey
  })

  it('always returns a 5-digit numeric string within 10000-99999', async () => {
    const { generateUserCode } = await loadSupabase()

    for (let i = 0; i < 1000; i++) {
      const code = generateUserCode()
      expect(code).toMatch(/^\d{5}$/)
      const value = Number(code)
      expect(value).toBeGreaterThanOrEqual(10000)
      expect(value).toBeLessThanOrEqual(99999)
    }
  })
})
