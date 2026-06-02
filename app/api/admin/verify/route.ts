import { NextRequest, NextResponse } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  checkAdmin,
  createAdminSessionToken,
  safeCompare,
} from '@/lib/api-auth'
import { clearFailure, isLocked, recordFailure } from '@/lib/admin-rate-limit'

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  clearAdminCookie(res)
  return res
}

function clientKey(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
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
  if (await isLocked(key)) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
  }

  const { password } = await req.json()
  if (safeCompare(password, process.env.ADMIN_PASSWORD)) {
    const token = createAdminSessionToken()
    if (!token) {
      return NextResponse.json({ error: 'Admin auth is not configured' }, { status: 500 })
    }

    await clearFailure(key)
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
  await recordFailure(key)
  return NextResponse.json({ error: '認証エラー' }, { status: 403 })
}
