/**
 * 指定したマイグレーションSQLを本番Supabaseに直接適用する。
 * 使い方: node scripts/apply-migration.mjs supabase/migrations/<file>.sql
 *
 * 接続: .env.local の SUPABASE_DB_URL（直接Postgres接続）を使用。
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFile } from 'fs/promises'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env.local') })

const relPath = process.argv[2]
if (!relPath) {
  console.error('使い方: node scripts/apply-migration.mjs <path-to-sql>')
  process.exit(1)
}

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL が未設定です')
  process.exit(1)
}

const sqlPath = resolve(__dirname, '..', relPath)

async function main() {
  const sql = await readFile(sqlPath, 'utf8')
  console.log(`=== マイグレーション適用 ===`)
  console.log(`ファイル: ${relPath}`)
  console.log(`SQL バイト数: ${sql.length}`)

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()
  console.log('接続成功。適用中...')

  try {
    await client.query('begin')
    await client.query(sql)
    await client.query('commit')
    console.log('✅ 適用成功（commit）')
  } catch (err) {
    await client.query('rollback')
    console.error('❌ 適用失敗（rollback）:', err.message)
    throw err
  }

  // 検証: join_event 関数の定義に unique_violation ガードが含まれるか確認
  const { rows } = await client.query(
    `select pg_get_functiondef(p.oid) as def
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'join_event'`
  )
  if (rows.length > 0) {
    const hasGuard = rows[0].def.includes('unique_violation')
    console.log(`\n検証: join_event 関数 存在=yes / unique_violation ガード=${hasGuard ? 'あり ✅' : 'なし ❌'}`)
  } else {
    console.log('\n検証: join_event 関数が見つかりません')
  }

  await client.end()
  console.log('\n完了')
}

main().catch(err => {
  console.error('エラー:', err)
  process.exit(1)
})
