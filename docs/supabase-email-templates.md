# Supabase Auth メールテンプレート

本番 Supabase Studio の `Authentication > Emails > Templates` に貼り付ける文面です。

## Confirm sign up

対象: `Authentication > Emails > Templates > Confirm sign up`

件名:

```text
ぶらんかーず｜メールアドレス確認コード
```

本文:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #111827;">
  <h2 style="margin: 0 0 16px; font-size: 20px;">ぶらんかーず メールアドレス確認</h2>

  <p style="margin: 0 0 16px;">
    ぶらんかーず参加管理への新規登録を受け付けました。
    登録画面に戻り、下の6桁の確認コードを入力すると会員登録が完了します。
  </p>

  <p style="margin: 24px 0 8px; font-size: 13px; color: #6b7280;">確認コード</p>
  <p style="margin: 0 0 24px; font-size: 32px; font-weight: 700; letter-spacing: 0.12em;">
    {{ .Token }}
  </p>

  <p style="margin: 0 0 16px;">
    このコードは一定時間で無効になります。心当たりがない場合は、このメールを破棄してください。
  </p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

  <p style="margin: 0 0 12px; font-size: 13px; color: #6b7280;">
    コード入力でうまく進めない場合のみ、以下のリンクから確認できます。
  </p>
  <p style="margin: 0;">
    <a href="{{ .ConfirmationURL }}" style="color: #2563eb;">メールアドレスを確認する</a>
  </p>
</div>
```

## 適用メモ

- `{{ .Token }}` はSupabaseが発行する6桁の確認コードです。
- `{{ .ConfirmationURL }}` はリンク確認用のURLです。主導線は6桁コードですが、代替手段として残します。
- Supabaseの無料内蔵メールは1時間2通制限があるため、テスト送信は必要最小限にします。
