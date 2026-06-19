import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const envRaw = await fs.readFile(path.join(root, '.env.local'), 'utf8')
const env = Object.fromEntries(
  envRaw
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')]
    })
)

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const QA_AUTH_EMAIL = process.env.QA_AUTH_EMAIL ?? env.QA_AUTH_EMAIL

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !QA_AUTH_EMAIL) {
  throw new Error('Required Supabase environment values are missing.')
}

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const [emailLocalPart, emailDomain] = QA_AUTH_EMAIL.split('@')
if (!emailLocalPart || !emailDomain) {
  throw new Error('QA_AUTH_EMAIL must be a valid email address.')
}
const email = `${emailLocalPart}+auth-confirm-${runId}@${emailDomain}`
const password = `QaAuth${runId}!`
let authUserId = null

try {
  const { data: signUpData, error: signUpError } = await supabaseAuth.auth.signUp({
    email,
    password,
    options: { data: { display_name: `QA Auth ${runId}` } },
  })

  if (signUpError) throw signUpError
  authUserId = signUpData.user?.id ?? null

  const { data: signInData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
    email,
    password,
  })

  const result = {
    emailConfirmationRequired: signUpData.session === null,
    sessionReturnedBeforeEmailConfirmation: signUpData.session !== null,
    signInBeforeConfirmationBlocked: signInData.session === null && Boolean(signInError),
    signInErrorMessage: signInError?.message ?? null,
    authUserCreated: Boolean(authUserId),
    cleanupAttempted: Boolean(authUserId),
  }

  console.log(JSON.stringify(result, null, 2))

  if (!result.emailConfirmationRequired || !result.signInBeforeConfirmationBlocked) {
    process.exitCode = 1
  }
} finally {
  if (authUserId) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(authUserId)
    if (error) {
      console.error(JSON.stringify({ cleanupError: error.message }))
      process.exitCode = 1
    }
  }
}
