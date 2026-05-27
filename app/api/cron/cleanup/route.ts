import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'

/**
 * Vercel Cron Job: 毎日 15:00 UTC (= 00:00 JST) に実行
 * 終了日時が過去のイベント（当日の日付が変わったもの）を自動削除する
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: '認証エラー' }, { status: 401 })
  }

  const supabase = getServerSupabase()

  // 終了日時が現在より前のイベントを取得
  const { data: expiredEvents, error: fetchError } = await supabase
    .from('events')
    .select('id')
    .lt('event_end_date', new Date().toISOString())

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!expiredEvents || expiredEvents.length === 0) {
    return NextResponse.json({ deleted: 0 })
  }

  const ids = expiredEvents.map(e => e.id)

  // 参加者を先に削除（外部キー制約がある場合に備えて）
  const { error: participantsError } = await supabase
    .from('participants')
    .delete()
    .in('event_id', ids)

  if (participantsError) {
    return NextResponse.json({ error: participantsError.message }, { status: 500 })
  }

  // イベントを削除
  const { error: eventsError } = await supabase
    .from('events')
    .delete()
    .in('id', ids)

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: ids.length })
}
