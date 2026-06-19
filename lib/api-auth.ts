import crypto from 'crypto'
import { NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'
import type { Member } from '@/lib/supabase'
import { touchMemberLastAccess } from '@/lib/server-member'

export const ADMIN_SESSION_COOKIE = 'basketball_admin_session'
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

type AuthMemberResult =
  | { member: Member; status?: never; error?: never }
  | { member?: never; status: number; error: string }

function getAdminSessionSecret(): string | null {
  return process.env.ADMIN_SESSION_SECRET || null
}

export function signAdminSessionPayload(payload: string): string | null {
  const secret = getAdminSessionSecret()
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

export function safeCompare(a: unknown, b: unknown): boolean {
  const left = Buffer.from(typeof a === 'string' ? a : '', 'utf8')
  const right = Buffer.from(typeof b === 'string' ? b : '', 'utf8')
  const comparable = typeof a === 'string' && typeof b === 'string' && a.length > 0 && b.length > 0

  if (left.length !== right.length) {
    const maxLength = Math.max(left.length, right.length, 1)
    const paddedLeft = Buffer.alloc(maxLength)
    const paddedRight = Buffer.alloc(maxLength)
    left.copy(paddedLeft)
    right.copy(paddedRight)
    crypto.timingSafeEqual(paddedLeft, paddedRight)
    return false
  }

  return comparable && crypto.timingSafeEqual(left, right)
}

export function createAdminSessionToken(now = Date.now()): string | null {
  const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS
  const nonce = crypto.randomBytes(16).toString('base64url')
  const payload = `${expiresAt}.${nonce}`
  const signature = signAdminSessionPayload(payload)
  return signature ? `${payload}.${signature}` : null
}

export function verifyAdminSessionToken(token: string | null | undefined, now = Date.now()): boolean {
  if (!token) return false

  const [expiresAtRaw, nonce, signature, ...extra] = token.split('.')
  if (extra.length > 0 || !expiresAtRaw || !nonce || !signature) return false

  const expiresAt = Number(expiresAtRaw)
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false

  const expectedSignature = signAdminSessionPayload(`${expiresAtRaw}.${nonce}`)
  return safeCompare(signature, expectedSignature)
}

export function checkAdmin(req: NextRequest): boolean {
  return verifyAdminSessionToken(req.cookies.get(ADMIN_SESSION_COOKIE)?.value)
}

export function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization')
  if (!header?.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice('bearer '.length).trim()
  return token || null
}

export async function getBearerUser(req: NextRequest): Promise<User | null> {
  const token = getBearerToken(req)
  if (!token) return null

  const { getAuthSupabase } = await import('@/lib/supabase-server')
  const authSupabase = getAuthSupabase()
  const { data, error } = await authSupabase.auth.getUser(token)
  if (error) return null
  return data.user ?? null
}

export async function getAuthenticatedMember(
  req: NextRequest,
  requestedMemberId?: string | null
): Promise<AuthMemberResult> {
  const token = getBearerToken(req)
  if (!token) {
    return { status: 401, error: 'ログインが必要です' }
  }

  const { getAuthSupabase, getServerSupabase } = await import('@/lib/supabase-server')
  const authSupabase = getAuthSupabase()
  const { data, error } = await authSupabase.auth.getUser(token)
  if (error || !data.user) {
    return { status: 401, error: 'ログイン情報を確認できませんでした' }
  }

  const supabase = getServerSupabase()
  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('*')
    .eq('auth_user_id', data.user.id)
    .single<Member>()

  if (memberError || !member) {
    return { status: 403, error: '会員情報が見つかりません' }
  }

  if (requestedMemberId && requestedMemberId !== member.id) {
    return { status: 403, error: '本人確認に失敗しました' }
  }

  await touchMemberLastAccess(member)
  return { member }
}
