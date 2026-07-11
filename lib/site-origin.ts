import { headers } from 'next/headers'

// Server Component から絶対URLを組み立てるための origin 解決。
// next/headers に依存するため supabase-server.ts 等とはファイルを分けている（server-member.ts と同方針）。
// Route Handler の req.nextUrl.origin（app/api/events/[id]/ics/route.ts）と同じ役割を、
// Server Component 側（next/headers しか使えない）で再現する。
export async function getSiteOrigin(): Promise<string> {
  const headersList = await headers()
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host') ?? 'localhost:3000'
  const proto = headersList.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`
}
