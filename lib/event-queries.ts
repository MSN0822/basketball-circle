import type { SupabaseClient } from '@supabase/supabase-js'
import type { Event, PublicParticipant } from '@/lib/supabase'
import { isVisibleToMembers, withEffectiveEventStatus } from '@/lib/event-visibility'

// lib/participation-query.ts と同じ規約:
//   - supabase クライアントは引数で受け取る（テストからモックを渡せるようにする）
//   - Supabase の error は握り潰さず throw する
//
// error を握り潰して空配列や null にすると、DB 障害が「イベント0件」「404」と区別できず
// 障害に気づけない。呼び出し元の Server Component が throw すれば app/error.tsx が出る。

export async function getVisibleEventsForMembers(supabase: SupabaseClient): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('event_date', { ascending: true })

  if (error) throw new Error(error.message)

  return ((data as Event[] | null) ?? [])
    .filter(event => isVisibleToMembers(event))
    .map(event => withEffectiveEventStatus(event))
}

// 会員に非公開のイベント・存在しないイベントだけが null。DB 障害は throw する。
export async function getVisibleEventById(supabase: SupabaseClient, eventId: string): Promise<Event | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle<Event>()

  if (error) throw new Error(error.message)
  if (!data || !isVisibleToMembers(data)) return null

  return withEffectiveEventStatus(data)
}

export async function getRosterParticipants(
  supabase: SupabaseClient,
  eventId: string,
): Promise<PublicParticipant[]> {
  const { data, error } = await supabase
    .from('participants_public')
    .select('id,event_id,name,status,slot_number,created_at,display_code')
    .eq('event_id', eventId)
    .neq('status', 'cancelled')
    .order('slot_number', { ascending: true })

  if (error) throw new Error(error.message)

  return (data as PublicParticipant[] | null) ?? []
}
