import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'

const DELETE_BATCH_SIZE = 100

/**
 * Vercel Cron Job: 毎日 15:00 UTC (= 00:00 JST) に実行
 * 終了日時が過去のイベント（当日の日付が変わったもの）を自動削除する
 * CRON_SECRET を Vercel 環境変数に設定しないと自動削除は動きません
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Cron secret is not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
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
  let deleted = 0

  for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
    const batchIds = ids.slice(index, index + DELETE_BATCH_SIZE)

    // participants は schema.sql の on delete cascade に任せる。
    // 途中失敗しても削除済みバッチは冪等で、残りは次回 cron で再回収される。
    const { error: eventsError } = await supabase
      .from('events')
      .delete()
      .in('id', batchIds)

    if (eventsError) {
      return NextResponse.json(
        { error: eventsError.message, deleted, attempted: ids.length },
        { status: 500 }
      )
    }

    deleted += batchIds.length
  }

  return NextResponse.json({ deleted })
}
