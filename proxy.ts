import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ADMIN_SESSION_COOKIE = 'basketball_admin_session'

function constantTimeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length, 1)
  let diff = a.length ^ b.length
  for (let i = 0; i < maxLength; i++) {
    diff |= a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length)
  }
  return diff === 0
}

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function signAdminSessionPayloadEdge(payload: string): Promise<string | null> {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) return null

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return toBase64Url(signature)
}

// Edge ランタイム（Web Crypto）側のトークン検証。lib/api-auth.ts（Node 側）の
// verifyAdminSessionToken と等価であることをユニットテストで担保するため export している。
export async function verifyAdminSessionTokenEdge(
  token: string | null | undefined,
  now: number = Date.now()
): Promise<boolean> {
  if (!token) return false

  const [expiresAtRaw, nonce, signature, ...extra] = token.split('.')
  if (extra.length > 0 || !expiresAtRaw || !nonce || !signature) return false

  const expiresAt = Number(expiresAtRaw)
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false

  const expectedSignature = await signAdminSessionPayloadEdge(`${expiresAtRaw}.${nonce}`)
  return expectedSignature ? constantTimeEqual(signature, expectedSignature) : false
}

async function checkAdminSession(request: NextRequest): Promise<boolean> {
  return verifyAdminSessionTokenEdge(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin') {
      return NextResponse.next()
    }
    if (!(await checkAdminSession(request))) {
      return NextResponse.redirect(new URL('/admin', request.url))
    }
    return NextResponse.next()
  }

  // 認証不要のルート
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          // リフレッシュ済みトークンを request にも反映してから response を作り直す
          // （Supabase 公式パターン）。これを怠ると同一リクエスト内の Server Component
          // が cookies() で古いアクセストークンを読み、SSR の会員解決が失敗する。
          cookies.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          response = NextResponse.next({ request })
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
