import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env.local') })

const connectionString = process.env.SUPABASE_DB_URL

if (!connectionString) {
  console.error('SUPABASE_DB_URL is not set.')
  process.exit(1)
}

const checks = [
  {
    id: 'Q1',
    item: 'participants_event_slot_active_uq',
    sql: "SELECT to_regclass('public.participants_event_slot_active_uq') IS NOT NULL AS applied",
    interpret: rows => booleanStatus(rows[0]?.applied),
    evidence: rows => `applied=${formatValue(rows[0]?.applied)}`,
  },
  {
    id: 'Q2',
    item: 'join_event unique_violation guard',
    sql: "SELECT pg_get_functiondef(oid) LIKE '%unique_violation%' AS applied FROM pg_proc WHERE proname='join_event' AND pronamespace='public'::regnamespace LIMIT 1",
    interpret: rows => singleBooleanStatus(rows, 'applied'),
    evidence: rows => evidenceOrNoRow(rows, 'applied'),
  },
  {
    id: 'Q3',
    item: 'cancel_participant slot rerank',
    sql: "SELECT pg_get_functiondef(oid) LIKE '%slot_number = -ranked%' AS applied FROM pg_proc WHERE proname='cancel_participant' AND pronamespace='public'::regnamespace LIMIT 1",
    interpret: rows => singleBooleanStatus(rows, 'applied'),
    evidence: rows => evidenceOrNoRow(rows, 'applied'),
  },
  {
    id: 'Q4',
    item: 'update_member_name participants update',
    queries: [
      {
        label: 'Q4a',
        sql: "SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='update_member_name' AND pronamespace='public'::regnamespace) AS func_exists",
      },
      {
        label: 'Q4b',
        sql: "SELECT pg_get_functiondef(oid) LIKE '%participants%' AS updates_participants FROM pg_proc WHERE proname='update_member_name' AND pronamespace='public'::regnamespace LIMIT 1",
      },
    ],
    interpret: results => {
      const funcExists = results.Q4a.rows[0]?.func_exists
      const updatesParticipants = results.Q4b.rows[0]?.updates_participants
      if (funcExists === false) return '未適用'
      if (funcExists === true && updatesParticipants === true) return '適用済み'
      return '要目視'
    },
    evidence: results => {
      const funcExists = results.Q4a.rows[0]?.func_exists
      const updatesParticipants = results.Q4b.rows[0]?.updates_participants
      const q4bEvidence = results.Q4b.rows.length === 0
        ? 'updates_participants=no row'
        : `updates_participants=${formatValue(updatesParticipants)}`
      return `func_exists=${formatValue(funcExists)}, ${q4bEvidence}`
    },
  },
  {
    id: 'Q5',
    item: 'admin_login_attempts',
    sql: "SELECT to_regclass('public.admin_login_attempts') IS NOT NULL AS applied",
    interpret: rows => booleanStatus(rows[0]?.applied),
    evidence: rows => `applied=${formatValue(rows[0]?.applied)}`,
  },
  {
    id: 'Q5b',
    item: 'record_admin_login_failure RPC',
    sql: "SELECT to_regprocedure('public.record_admin_login_failure(text, integer, integer, integer)') IS NOT NULL AS applied",
    interpret: rows => booleanStatus(rows[0]?.applied),
    evidence: rows => `applied=${formatValue(rows[0]?.applied)}`,
  },
  {
    id: 'Q6',
    item: 'participants_delete policy removed',
    sql: "SELECT NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='participants' AND policyname='participants_delete') AS applied",
    interpret: rows => booleanStatus(rows[0]?.applied),
    evidence: rows => `applied=${formatValue(rows[0]?.applied)}`,
  },
  {
    id: 'Q7',
    item: 'revoke register_member anon execute',
    // このマイグレーションは anon から execute を剥奪する。
    // 適用済み = anon に execute 権限が無い (false)。判定は反転させる。
    sql: "SELECT has_function_privilege('anon','public.register_member(text, uuid)','execute') AS anon_has_execute",
    interpret: rows => {
      const value = rows[0]?.anon_has_execute
      if (value === false) return '適用済み'
      if (value === true) return '未適用'
      return '要目視'
    },
    evidence: rows => `anon_has_execute=${formatValue(rows[0]?.anon_has_execute)}`,
  },
  {
    id: 'Q8',
    item: 'private RPC execute restricted to service_role',
    sql: `
      SELECT
        NOT has_function_privilege('anon','public.join_event(uuid,text,text,uuid,boolean)','execute')
        AND NOT has_function_privilege('authenticated','public.join_event(uuid,text,text,uuid,boolean)','execute')
        AND NOT has_function_privilege('anon','public.cancel_participant(uuid)','execute')
        AND NOT has_function_privilege('authenticated','public.cancel_participant(uuid)','execute')
        AND NOT has_function_privilege('anon','public.update_member_name(uuid, uuid, text)','execute')
        AND NOT has_function_privilege('authenticated','public.update_member_name(uuid, uuid, text)','execute')
        AND NOT has_function_privilege('anon','public.register_member(text, uuid)','execute')
        AND NOT has_function_privilege('authenticated','public.register_member(text, uuid)','execute')
        AND has_function_privilege('service_role','public.join_event(uuid,text,text,uuid,boolean)','execute')
        AND has_function_privilege('service_role','public.cancel_participant(uuid)','execute')
        AND has_function_privilege('service_role','public.update_member_name(uuid, uuid, text)','execute')
        AND has_function_privilege('service_role','public.register_member(text, uuid)','execute')
        AS applied
    `,
    interpret: rows => booleanStatus(rows[0]?.applied),
    evidence: rows => `applied=${formatValue(rows[0]?.applied)}`,
  },
  {
    id: 'Q9',
    item: 'public read model: members own select + scheduled draft publish surfaces',
    sql: `
      SELECT
        EXISTS(
          SELECT 1 FROM pg_policies
          WHERE schemaname='public'
            AND tablename='members'
            AND policyname='members_select_own'
            AND cmd='SELECT'
            AND roles::text = '{authenticated}'
        )
        AND NOT EXISTS(
          SELECT 1 FROM pg_policies
          WHERE schemaname='public'
            AND tablename='participants'
            AND cmd='SELECT'
        )
        AND EXISTS(
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname='public'
            AND c.relname='participants_public'
            AND c.relkind='v'
            AND COALESCE(c.reloptions, ARRAY[]::text[]) @> ARRAY['security_invoker=false']
        )
        AND EXISTS(
          SELECT 1
          FROM pg_policies
          WHERE schemaname='public'
            AND tablename='events'
            AND policyname='events_select'
            AND cmd='SELECT'
            AND roles::text = '{authenticated}'
            AND qual LIKE '%draft%'
            AND qual LIKE '%publishes_at%'
        )
        AND EXISTS(
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname='public'
            AND c.relname='participants_public'
            AND pg_get_viewdef(c.oid) LIKE '%draft%'
            AND pg_get_viewdef(c.oid) LIKE '%publishes_at%'
        )
        AND NOT EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='participants_public'
            AND column_name='member_id'
        )
        AND NOT has_table_privilege('anon', 'public.participants_public', 'select')
        AND has_table_privilege('authenticated', 'public.participants_public', 'select')
        AS applied
    `,
    interpret: rows => booleanStatus(rows[0]?.applied),
    evidence: rows => `applied=${formatValue(rows[0]?.applied)}`,
  },
]

const additionalQueries = [
  {
    id: 'A1',
    title: 'participants policies',
    sql: "SELECT policyname, cmd, roles::text FROM pg_policies WHERE schemaname='public' AND tablename='participants' ORDER BY policyname",
  },
  {
    id: 'A1b',
    title: 'participants_public view options',
    sql: "SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='participants_public'",
  },
  {
    id: 'A2',
    title: 'register_member execute privileges',
    sql: "SELECT has_function_privilege('anon','public.register_member(text, uuid)','execute') AS anon_exec, has_function_privilege('authenticated','public.register_member(text, uuid)','execute') AS auth_exec",
  },
  {
    id: 'A3',
    title: 'private RPC execute privileges',
    sql: "SELECT has_function_privilege('anon','public.join_event(uuid,text,text,uuid,boolean)','execute') AS anon_join, has_function_privilege('authenticated','public.join_event(uuid,text,text,uuid,boolean)','execute') AS auth_join, has_function_privilege('anon','public.cancel_participant(uuid)','execute') AS anon_cancel, has_function_privilege('authenticated','public.cancel_participant(uuid)','execute') AS auth_cancel, has_function_privilege('anon','public.update_member_name(uuid, uuid, text)','execute') AS anon_update_member, has_function_privilege('authenticated','public.update_member_name(uuid, uuid, text)','execute') AS auth_update_member",
  },
  {
    id: 'A4',
    title: 'members policies',
    sql: "SELECT policyname, cmd, roles::text FROM pg_policies WHERE schemaname='public' AND tablename='members' ORDER BY policyname",
  },
]

function booleanStatus(value) {
  if (value === true) return '適用済み'
  if (value === false) return '未適用'
  return '要目視'
}

function singleBooleanStatus(rows, key) {
  if (rows.length === 0) return '要目視'
  return booleanStatus(rows[0]?.[key])
}

function evidenceOrNoRow(rows, key) {
  if (rows.length === 0) return `${key}=no row`
  return `${key}=${formatValue(rows[0]?.[key])}`
}

function formatValue(value) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return String(value)
}

function escapeMarkdown(value) {
  return formatValue(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function markdownTable(headers, rows) {
  const header = `| ${headers.join(' | ')} |`
  const divider = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map(row => `| ${row.map(escapeMarkdown).join(' | ')} |`)
  return [header, divider, ...body].join('\n')
}

async function runCheck(client, check) {
  if (check.queries) {
    const results = {}
    for (const query of check.queries) {
      results[query.label] = await runSelect(client, query.sql)
    }

    return {
      id: check.id,
      item: check.item,
      status: check.interpret(results),
      evidence: check.evidence(results),
    }
  }

  const result = await runSelect(client, check.sql)
  return {
    id: check.id,
    item: check.item,
    status: check.interpret(result.rows),
    evidence: check.evidence(result.rows),
  }
}

async function runSelect(client, sql) {
  const trimmed = sql.trim().toLowerCase()
  if (!trimmed.startsWith('select')) {
    throw new Error(`Refusing to run non-SELECT SQL: ${sql}`)
  }

  return client.query(sql)
}

async function main() {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()

  try {
    const checkResults = []
    for (const check of checks) {
      checkResults.push(await runCheck(client, check))
    }

    const additionalResults = []
    for (const query of additionalQueries) {
      additionalResults.push({
        ...query,
        rows: (await runSelect(client, query.sql)).rows,
      })
    }

    console.log('## Migration Status')
    console.log(markdownTable(
      ['項目', '判定', '対象', '根拠'],
      checkResults.map(result => [result.id, result.status, result.item, result.evidence])
    ))

    console.log('\n## Additional Output')
    for (const result of additionalResults) {
      console.log(`\n### ${result.id}: ${result.title}`)
      if (result.rows.length === 0) {
        console.log('(no rows)')
        continue
      }

      const headers = Object.keys(result.rows[0])
      console.log(markdownTable(
        headers,
        result.rows.map(row => headers.map(header => row[header]))
      ))
    }
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
