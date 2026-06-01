import { NextRequest, NextResponse } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  checkAdmin,
  createAdminSessionToken,
  safeCompare,
} from '@/lib/api-auth'

type AttemptState = {
  count: number
  resetAt: number
  lockedUntil: number
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  clearAdminCookie(res)
  return res
}

const attempts = new Map<string, AttemptState>()
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 5

function clientKey(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

function getAttemptState(key: string, now = Date.now()): AttemptState {
  const current = attempts.get(key)
  if (!current) {
    return { count: 0, resetAt: now + ATTEMPT_WINDOW_MS, lockedUntil: 0 }
  }
  // ロック中はウィンドウ失効によるリセットを行わず、ロックを最後まで維持する
  // （lockedUntil > resetAt のケースでロックが想定より早く解けるのを防ぐ）
  if (current.lockedUntil > now) {
    return current
  }
  if (current.resetAt <= now) {
    return { count: 0, resetAt: now + ATTEMPT_WINDOW_MS, lockedUntil: 0 }
  }
  return current
}

function isLocked(key: string, now = Date.now()): boolean {
  const current = getAttemptState(key, now)
  return current.lockedUntil > now
}

function recordFailure(key: string, now = Date.now()) {
  const current = getAttemptState(key, now)
  const nextCount = current.count + 1
  attempts.set(key, {
    count: nextCount,
    resetAt: current.resetAt,
    lockedUntil: nextCount >= MAX_ATTEMPTS ? now + LOCK_MS : current.lockedUntil,
  })
}

function clearFailure(key: string) {
  attempts.delete(key)
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
  const key = clientKey(req)
  if (isLocked(key)) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
  }

  const { password } = await req.json()
  if (safeCompare(password, process.env.ADMIN_PASSWORD)) {
    const token = createAdminSessionToken()
    if (!token) {
      return NextResponse.json({ error: 'Admin auth is not configured' }, { status: 500 })
    }

    clearFailure(key)
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
  recordFailure(key)
  return NextResponse.json({ error: '認証エラー' }, { status: 403 })
}
