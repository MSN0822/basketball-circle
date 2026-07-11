// signUp 呼び出しのエラーを、送信上限到達 / メール関連エラー / その他 の3パターンに分類して表示文言を決める。
export function getSignupErrorMessage(error: { code?: string; message?: string; status?: number } | null): string {
  if (!error) {
    return '登録に失敗しました。確認メールが届かない場合は、1時間ほど空けてからもう一度登録してください。'
  }
  const message = error.message?.toLowerCase() ?? ''
  if (
    error.code === 'over_email_send_rate_limit' ||
    error.status === 429 ||
    message.includes('rate limit') ||
    message.includes('email rate') ||
    message.includes('sending confirmation email')
  ) {
    return '現在、確認メールの送信上限に達しています。お手数ですが、1時間ほど空けてからもう一度登録してください。'
  }
  if (message.includes('email')) {
    return '確認メールの送信に失敗しました。メールアドレスを確認し、時間を空けてからもう一度登録してください。'
  }
  return error.message ?? '登録に失敗しました。時間を空けてからもう一度登録してください。'
}
