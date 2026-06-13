import { NextRequest, NextResponse } from 'next/server'
import { safeCompare } from '@/lib/api-auth'
import { publishDueDraftEvents } from '@/lib/event-publishing'
import { getServerSupabase } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Cron secret is not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  if (!safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: '認証エラー' }, { status: 401 })
  }

  try {
    await publishDueDraftEvents(getServerSupabase())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '予約公開の反映に失敗しました' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
