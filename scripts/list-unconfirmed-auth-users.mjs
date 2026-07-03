import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// メール確認（OTP）未完了のまま残っている auth ユーザーを洗い出す。
// メール確認 OFF への切替前に必ず実行する（docs/EMAIL_SWITCHOVER_RUNBOOK.md 参照）。
// 未確認ユーザーは切替後もログイン不能のまま取り残されるため、切替前に一括 confirm が必要。
//
// 使い方:
//   dry-run（表示のみ・既定）: node scripts/list-unconfirmed-auth-users.mjs
//   一括 confirm（二重ガード）:
//     PowerShell: $env:CONFIRM_APPLY='1'; node scripts/list-unconfirmed-auth-users.mjs --apply
//     Bash:       CONFIRM_APPLY=1 node scripts/list-unconfirmed-auth-users.mjs --apply
//   ※ email_confirm: true への更新は元に戻せない。dry-run の一覧を目視確認してから実行する。

const root = process.cwd()
const envPath = path.join(root, '.env.local')

function parseEnv(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .map(line => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      })
  )
}

const envRaw = await fs.readFile(envPath, 'utf8')
const env = parseEnv(envRaw)

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local.')
}

const applyRequested = process.argv.includes('--apply')

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const PER_PAGE = 1000
const allUsers = []
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
  if (error) throw error
  allUsers.push(...data.users)
  if (data.users.length < PER_PAGE) break
}

const unconfirmed = allUsers.filter(user => !user.email_confirmed_at)

console.log(`対象 Supabase: ${supabaseUrl}`)
console.log(`auth ユーザー総数: ${allUsers.length} / メール未確認: ${unconfirmed.length}`)

if (unconfirmed.length === 0) {
  console.log('未確認ユーザーはいません。メール確認 OFF への切替はいつでも安全に実行できます。')
  process.exit(0)
}

const memberByAuthId = new Map()
const ids = unconfirmed.map(user => user.id)
for (let index = 0; index < ids.length; index += 100) {
  const batch = ids.slice(index, index + 100)
  const { data: members, error } = await admin
    .from('members')
    .select('id, name, auth_user_id')
    .in('auth_user_id', batch)
  if (error) throw error
  for (const member of members ?? []) memberByAuthId.set(member.auth_user_id, member)
}

const rows = unconfirmed.map(user => ({
  email: user.email ?? '(email なし)',
  authUserId: user.id,
  createdAt: user.created_at,
  memberRow: memberByAuthId.has(user.id) ? memberByAuthId.get(user.id).name : 'なし（切替後に詰む）',
}))

console.table(rows)
console.log('memberRow が「なし」のユーザーは members 行が未作成（コード未入力のまま離脱）。')
console.log('メール確認 OFF に切り替えるとこのユーザーは永久にログインできなくなるため、切替前に一括 confirm する。')

if (!applyRequested) {
  console.log('')
  console.log('dry-run（表示のみ）で終了しました。一括 confirm する場合:')
  console.log("  PowerShell: $env:CONFIRM_APPLY='1'; node scripts/list-unconfirmed-auth-users.mjs --apply")
  console.log('  Bash:       CONFIRM_APPLY=1 node scripts/list-unconfirmed-auth-users.mjs --apply')
  process.exit(0)
}

if (process.env.CONFIRM_APPLY !== '1') {
  console.error('--apply の実行には環境変数 CONFIRM_APPLY=1 が必要です（誤実行防止の二重ガード）。')
  process.exit(1)
}

console.log('')
console.log(`${rows.length} 件を email_confirm: true に更新します（元に戻せません）...`)

let confirmedCount = 0
const failed = []
for (const row of rows) {
  const { error } = await admin.auth.admin.updateUserById(row.authUserId, { email_confirm: true })
  if (error) {
    failed.push({ authUserId: row.authUserId, email: row.email, error: error.message })
  } else {
    confirmedCount += 1
  }
}

console.log(JSON.stringify({ ok: failed.length === 0, confirmed: confirmedCount, failed }, null, 2))
if (failed.length > 0) process.exit(1)
