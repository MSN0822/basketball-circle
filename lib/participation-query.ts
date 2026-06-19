import type { SupabaseClient } from '@supabase/supabase-js'
import { Participant, PublicParticipant } from '@/lib/supabase'
import { isVisibleToMembers } from '@/lib/event-visibility'

type VisibleEventFields = {
  id: string
  status: 'accepting' | 'closed' | 'draft' | 'archived'
  publishes_at: string | null
  closes_at: string | null
}

type ParticipantWithEvent = Participant & {
  events?: VisibleEventFields | null
}

export function guestDisplayCode(userCode: string) {
  return userCode.startsWith('guest:') ? userCode.split(':').at(-1) ?? null : null
}

// user_code はキャンセル検証コードのため、クライアント（APIレスポンス・RSC props）へ
// 渡すデータは必ずこの関数を通して user_code / member_id を除去すること。
export function toPublicParticipant(participant: (Participant & { events?: unknown }) | null | undefined): PublicParticipant | null {
  if (!participant) return null
  const userCode = participant.user_code
  const safeParticipant = { ...participant } as Partial<Participant & { events?: unknown }>
  delete safeParticipant.user_code
  delete safeParticipant.member_id
  delete safeParticipant.events
  return {
    ...(safeParticipant as Omit<Participant, 'user_code' | 'member_id'>),
    display_code: guestDisplayCode(userCode),
  }
}

// 会員が申請中の全参加行（会員に公開中のイベント分のみ）を返す。イベント一覧のバッジ表示用。
export async function getMyParticipations(
  supabase: SupabaseClient,
  memberId: string,
): Promise<PublicParticipant[]> {
  const { data, error } = await supabase
    .from('participants')
    .select('*, events!inner(id,status,publishes_at,closes_at)')
    .eq('member_id', memberId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  return ((data as ParticipantWithEvent[] | null) ?? [])
    .filter(row => row.events && isVisibleToMembers(row.events))
    .map(toPublicParticipant)
    .filter((participation): participation is PublicParticipant => participation !== null)
}

export async function getMyParticipationAndGuests(
  supabase: SupabaseClient,
  eventId: string,
  memberId: string,
): Promise<{ participation: PublicParticipant | null; guests: PublicParticipant[] }> {
  const [{ data: participation, error: participationError }, { data: guests, error: guestsError }] =
    await Promise.all([
      supabase
        .from('participants')
        .select('*')
        .eq('event_id', eventId)
        .eq('member_id', memberId)
        .neq('status', 'cancelled')
        .limit(1)
        .maybeSingle<Participant>(),
      supabase
        .from('participants')
        .select('*')
        .eq('event_id', eventId)
        .neq('status', 'cancelled')
        .like('user_code', `guest:${memberId}:%`)
        .order('created_at', { ascending: true }),
    ])

  if (participationError || guestsError) {
    throw new Error(participationError?.message ?? guestsError?.message ?? '参加情報の取得に失敗しました')
  }

  return {
    participation: toPublicParticipant(participation),
    guests: ((guests as Participant[] | null) ?? [])
      .map(toPublicParticipant)
      .filter((guest): guest is PublicParticipant => guest !== null),
  }
}
