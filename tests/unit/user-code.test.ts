import { describe, expect, it } from 'vitest'
import { generateUserCode } from '@/lib/user-code'

// lib/supabase.ts から切り出したことで env のセットアップが不要になった
// （旧 supabase.test.ts は NEXT_PUBLIC_SUPABASE_URL / ANON_KEY の設定と復元が必須だった）。
describe('generateUserCode', () => {
  it('always returns a 5-digit numeric string within 10000-99999', () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateUserCode()
      expect(code).toMatch(/^\d{5}$/)
      const value = Number(code)
      expect(value).toBeGreaterThanOrEqual(10000)
      expect(value).toBeLessThanOrEqual(99999)
    }
  })
})
