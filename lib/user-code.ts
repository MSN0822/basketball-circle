// 参加者のキャンセル検証コード（5桁）。
// env に依存しないため supabase.ts から分離している。route handler が値として import しても
// ブラウザ用 Supabase クライアントの初期化（env 必須）を巻き込まないようにするのが目的。
export function generateUserCode(): string {
  return Math.floor(10000 + Math.random() * 90000).toString()
}
