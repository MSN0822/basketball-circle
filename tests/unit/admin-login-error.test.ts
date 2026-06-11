import { describe, expect, it } from 'vitest'
import { adminLoginErrorMessage } from '@/lib/admin-login-error'

describe('adminLoginErrorMessage', () => {
  it('explains the lockout window for 429 (rate limited)', () => {
    expect(adminLoginErrorMessage(429)).toBe(
      '試行回数の上限に達しました。15分ほど待ってから再試行してください',
    )
  })

  it('points to ADMIN_SESSION_SECRET for 500 (admin auth not configured)', () => {
    expect(adminLoginErrorMessage(500)).toBe(
      'サーバー設定エラーです。管理者設定（ADMIN_SESSION_SECRET）を確認してください',
    )
  })

  it('reports a wrong password for 403', () => {
    expect(adminLoginErrorMessage(403)).toBe('パスワードが違います')
  })

  it('falls back to the wrong-password message for other failures (e.g. 400)', () => {
    expect(adminLoginErrorMessage(400)).toBe('パスワードが違います')
  })
})
