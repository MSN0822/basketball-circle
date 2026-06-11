// /api/admin/verify の POST は 429 (レートリミット中) / 500 (ADMIN_SESSION_SECRET
// 未設定) / 403 (パスワード不一致) を区別して返すが、UI が一律「パスワードが
// 違います」と表示するとロック中の再試行や設定漏れに気づけない。
export function adminLoginErrorMessage(status: number): string {
  if (status === 429) {
    return '試行回数の上限に達しました。15分ほど待ってから再試行してください'
  }
  if (status === 500) {
    return 'サーバー設定エラーです。管理者設定（ADMIN_SESSION_SECRET）を確認してください'
  }
  return 'パスワードが違います'
}
