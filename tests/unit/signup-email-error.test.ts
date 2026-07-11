import { describe, expect, it } from 'vitest'
import { getSignupErrorMessage } from '@/lib/signup-email-error'

describe('getSignupErrorMessage', () => {
  it('explains the send-rate-limit window for over_email_send_rate_limit', () => {
    expect(getSignupErrorMessage({ code: 'over_email_send_rate_limit', message: 'rate limit exceeded' })).toBe(
      '現在、確認メールの送信上限に達しています。お手数ですが、1時間ほど空けてからもう一度登録してください。',
    )
  })

  it('explains the send-rate-limit window for a 429 status', () => {
    expect(getSignupErrorMessage({ status: 429, message: 'too many requests' })).toBe(
      '現在、確認メールの送信上限に達しています。お手数ですが、1時間ほど空けてからもう一度登録してください。',
    )
  })

  it('reports a generic email failure when the message mentions email but is not rate-limited', () => {
    expect(getSignupErrorMessage({ message: 'Error sending email' })).toBe(
      '確認メールの送信に失敗しました。メールアドレスを確認し、時間を空けてからもう一度登録してください。',
    )
  })

  it('falls back to the raw Supabase message for unrelated errors', () => {
    expect(getSignupErrorMessage({ message: 'Password should be at least 6 characters' })).toBe(
      'Password should be at least 6 characters',
    )
  })

  it('falls back to a generic message when no error object is provided', () => {
    expect(getSignupErrorMessage(null)).toBe(
      '登録に失敗しました。確認メールが届かない場合は、1時間ほど空けてからもう一度登録してください。',
    )
  })
})
