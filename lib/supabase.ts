import { createClient } from '@supabase/supabase-js'

export type EventStatus = 'accepting' | 'closed' | 'draft' | 'archived'
export type ParticipantStatus = 'active' | 'cancelled' | 'waitlist'

export interface Event {
  id: string
  title: string
  event_date: string
  event_end_date: string | null
  location: string
  location_url: string | null
  closes_at: string | null
  publishes_at: string | null
  max_participants: number
  threshold: number
  status: EventStatus
  is_manual_close: boolean
  created_at: string
}

export interface Participant {
  id: string
  event_id: string
  name: string
  user_code: string
  member_id: string | null
  status: ParticipantStatus
  slot_number: number | null
  created_at: string
}

export type PublicParticipant = Omit<Participant, 'user_code' | 'member_id'> & {
  display_code: string | null
}

export interface Member {
  id: string
  member_number: string
  name: string
  auth_user_id: string | null
  created_at: string
  last_accessed_at: string
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase環境変数が未設定です (.env.local を確認してください)')
  return createClient(url, key)
}

export const supabase = getSupabaseClient()

export function generateUserCode(): string {
  return Math.floor(10000 + Math.random() * 90000).toString()
}
