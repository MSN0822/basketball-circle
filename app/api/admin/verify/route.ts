import { NextRequest, NextResponse } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  checkAdmin,
  createAdminSessionToken,
  safeCompare,
} from '@/lib/api-auth'
import { clearFailure, isLocked, recordFailure } from '@/lib/admin-rate-limit'

const GLOBAL_ADMIN_LOGIN_KEY = 'global:admin-login'

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  clearAdminCookie(res)
  return res
}

// Vercel always sets x-real-ip to the real client IP, so that is the trusted
// source in production. The x-forwarded-for fallback is best-effort only: the
// whole header is client-controlled, so it is NOT a trustworthy IP source if
// x-real-ip is ever absent. Per-IP limiting is therefore backed by the shared
// global:admin-login key (see rateLimitKeys), which caps brute force regardless
// of IP spoofing. Do not rely on the per-IP key alone as the sole control.
function clientIdentifier(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwardedFor = req.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean)

  return forwardedFor?.at(-1) ?? 'unknown'
}

function rateLimitKeys(req: NextRequest): string[] {
  return [`ip:${clientIdentifier(req)}`, GLOBAL_ADMIN_LOGIN_KEY]
}

async function anyLocked(keys: string[]) {
  const locked = await Promise.all(keys.map(key => isLocked(key)))
  return locked.some(Boolean)
}

async function recordFailures(keys: string[]) {
  await Promise.all(keys.map(key => recordFailure(key)))
}

async function clearFailures(keys: string[]) {
  await Promise.all(keys.map(key => clearFailure(key)))
}

function clearAdminCookie(res: NextResponse) {
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
}

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const keys = rateLimitKeys(req)
  if (await anyLocked(keys)) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as { password?: unknown } | null
  if (!body || typeof body !== 'object' || !('password' in body)) {
    await recordFailures(keys)
    return NextResponse.json({ error: 'password は必須です' }, { status: 400 })
  }

  const { password } = body
  if (safeCompare(password, process.env.ADMIN_PASSWORD)) {
    const token = createAdminSessionToken()
    if (!token) {
      return NextResponse.json({ error: 'Admin auth is not configured' }, { status: 500 })
    }

    await clearFailures(keys)
    const res = NextResponse.json({ ok: true })
    res.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    })
    return res
  }
  await recordFailures(keys)
  return NextResponse.json({ error: '認証エラー' }, { status: 403 })
}
