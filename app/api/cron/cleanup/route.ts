import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { safeCompare } from '@/lib/api-auth'

const CLEANUP_BATCH_SIZE = 100
const DORMANT_MEMBER_DAYS = 365

type DormantMember = {
  id: string
  auth_user_id: string | null
}

/**
 * Vercel Cron Job: 毎日 15:00 UTC (= 00:00 JST) に実行
 * - 終了日時を過ぎたイベントを status='archived' にしてユーザー画面から隠す（削除はしない）
 * - 365日アクセスのない休眠会員を削除する（参加履歴は member_id を null 化して残す）
 * CRON_SECRET を Vercel 環境変数に設定しないと動きません
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Cron secret is not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  if (!safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: '認証エラー' }, { status: 401 })
  }

  const supabase = getServerSupabase()
  const nowIso = new Date().toISOString()

  // 終了日時を過ぎたイベントはユーザー画面から隠し、管理者アーカイブに残す。
  const { data: expiredEvents, error: fetchError } = await supabase
    .from('events')
    .select('id')
    .lt('event_end_date', nowIso)
    .in('status', ['accepting', 'closed'])

  if (fetchError) {
    console.error('cron/cleanup: 期限切れイベントの取得に失敗', fetchError.message)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const eventIds = (expiredEvents ?? []).map(e => e.id)
  let archived = 0

  for (let index = 0; index < eventIds.length; index += CLEANUP_BATCH_SIZE) {
    const batchIds = eventIds.slice(index, index + CLEANUP_BATCH_SIZE)

    const { error: eventsError } = await supabase
      .from('events')
      .update({ status: 'archived', is_manual_close: false })
      .in('id', batchIds)

    if (eventsError) {
      console.error('cron/cleanup: イベントのアーカイブ化に失敗', eventsError.message, { archived, attemptedEvents: eventIds.length })
      return NextResponse.json(
        { error: eventsError.message, archived, attemptedEvents: eventIds.length },
        { status: 500 }
      )
    }

    archived += batchIds.length
  }

  const dormantBefore = new Date(Date.now() - DORMANT_MEMBER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: dormantMembers, error: dormantError } = await supabase
    .from('members')
    .select('id,auth_user_id')
    .lt('last_accessed_at', dormantBefore)
    .limit(CLEANUP_BATCH_SIZE)

  if (dormantError) {
    console.error('cron/cleanup: 休眠会員の取得に失敗', dormantError.message)
    return NextResponse.json({ error: dormantError.message, archived }, { status: 500 })
  }

  let deletedMembers = 0
  const authDeleteErrors: string[] = []

  for (const member of (dormantMembers ?? []) as DormantMember[]) {
    const { error: participantError } = await supabase
      .from('participants')
      .update({ member_id: null })
      .eq('member_id', member.id)

    if (participantError) {
      console.error('cron/cleanup: 参加履歴の member_id null 化に失敗', member.id, participantError.message)
      return NextResponse.json(
        { error: participantError.message, archived, deletedMembers },
        { status: 500 }
      )
    }

    const { error: memberError } = await supabase
      .from('members')
      .delete()
      .eq('id', member.id)

    if (memberError) {
      console.error('cron/cleanup: 休眠会員の削除に失敗', member.id, memberError.message)
      return NextResponse.json(
        { error: memberError.message, archived, deletedMembers },
        { status: 500 }
      )
    }

    deletedMembers += 1

    if (member.auth_user_id) {
      const { error: authError } = await supabase.auth.admin.deleteUser(member.auth_user_id)
      if (authError) {
        // members 行は削除済みのため、失敗した auth ユーザーは孤児として残る（要手動対応）
        console.error('cron/cleanup: auth ユーザー削除に失敗（孤児化）', member.auth_user_id, authError.message)
        authDeleteErrors.push(member.auth_user_id)
      }
    }
  }

  return NextResponse.json({
    archived,
    deletedMembers,
    authDeleteErrors,
  })
}
