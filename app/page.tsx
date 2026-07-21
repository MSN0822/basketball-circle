import type { Event, Member, PublicParticipant } from '@/lib/supabase'
import { getServerSupabase } from '@/lib/supabase-server'
import { getCookieMember } from '@/lib/server-member'
import { getMyParticipations } from '@/lib/participation-query'
import { getVisibleEventsForMembers } from '@/lib/event-queries'
import { publishDueDraftEvents } from '@/lib/event-publishing'
import MemberHeader from '@/components/MemberHeader'
import EventList from '@/components/EventList'

export const revalidate = 0

async function getEvents(): Promise<Event[]> {
  const supabase = getServerSupabase()
  await publishDueDraftEvents(supabase)
  return getVisibleEventsForMembers(supabase)
}

// このページはログインユーザごとに個人化したレスポンスを返す（revalidate=0 前提）。
// 'use cache' や cacheComponents をこのルートに導入しないこと。
export default async function HomePage() {
  const [events, cookieMember] = await Promise.all([getEvents(), getCookieMember()])

  // 申請状況をサーバ側で解決し、初回描画から「申請済み」バッジを表示する。
  // 解決に失敗した場合は member=null としてクライアント側フォールバックに委ねる。
  let member: Member | null = cookieMember
  let myParticipations: PublicParticipant[] | null = null
  if (cookieMember) {
    try {
      myParticipations = await getMyParticipations(getServerSupabase(), cookieMember.id)
    } catch (error) {
      // ここはイベント一覧そのものではなく「申請済みバッジ」の解決失敗なので、
      // 画面全体をエラーにせずクライアント側フォールバックへ委ねる（ログだけ残す）。
      console.error('[HomePage] 参加状況の取得に失敗しました:', error)
      member = null
    }
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-4">
      <div className="flex justify-end">
        <MemberHeader initialMember={member} />
      </div>
      <h1 className="text-2xl font-bold">ぶらんかーず</h1>

      {events.length === 0 ? (
        <p className="text-muted-foreground">現在公開中のイベントはありません</p>
      ) : (
        <EventList events={events} initialMyParticipations={myParticipations} />
      )}
    </main>
  )
}
