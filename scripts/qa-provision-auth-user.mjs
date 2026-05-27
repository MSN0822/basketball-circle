import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

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

function setEnvValue(raw, key, value) {
  const escaped = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(raw)) return raw.replace(pattern, escaped)
  return `${raw.trimEnd()}\n${escaped}\n`
}

const envRaw = await fs.readFile(envPath, 'utf8')
const env = parseEnv(envRaw)

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
const baseUrl = process.env.QA_BASE_URL ?? 'https://basketball-circle.vercel.app'
const adminPassword = env.ADMIN_PASSWORD

if (!supabaseUrl || !serviceRoleKey || !adminPassword) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ADMIN_PASSWORD are required.')
}

const runId = `QA_AUTH_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const email = env.QA_AUTH_EMAIL || `qa_auth_${runId.toLowerCase()}@example.com`
const password = env.QA_AUTH_PASSWORD || `QaAuth-${runId}-12345`
const displayName = `QA認証 太郎(${runId})`

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})
const authClient = createClient(supabaseUrl, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

let authUserId = ''

if (env.QA_AUTH_EMAIL && env.QA_AUTH_PASSWORD) {
  const { data } = await admin.auth.admin.listUsers()
  const existing = data.users.find(user => user.email === env.QA_AUTH_EMAIL)
  if (existing) authUserId = existing.id
}

if (!authUserId) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  authUserId = data.user.id
} else {
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    password,
    email_confirm: true,
  })
  if (error) throw error
}

const { data: sessionData, error: loginError } = await authClient.auth.signInWithPassword({ email, password })
if (loginError || !sessionData.session?.access_token) {
  throw loginError ?? new Error('QA auth session was not created.')
}

const { data: existingMembers, error: selectError } = await admin
  .from('members')
  .select('id, name, auth_user_id')
  .eq('auth_user_id', authUserId)
  .limit(1)

if (selectError) throw selectError

let memberId = existingMembers?.[0]?.id ?? ''

if (!memberId) {
  const res = await fetch(`${baseUrl}/api/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ name: displayName, auth_user_id: authUserId }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Member registration failed: ${res.status} ${body.slice(0, 200)}`)
  }
  const body = await res.json()
  memberId = body.member.id
}

let nextEnv = envRaw
nextEnv = setEnvValue(nextEnv, 'QA_AUTH_EMAIL', email)
nextEnv = setEnvValue(nextEnv, 'QA_AUTH_PASSWORD', password)
await fs.writeFile(envPath, nextEnv, 'utf8')

console.log(JSON.stringify({
  ok: true,
  emailConfigured: true,
  passwordConfigured: true,
  authUserId,
  memberId,
}, null, 2))
