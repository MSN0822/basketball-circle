import { NextRequest } from 'next/server'
import { Member } from '@/lib/supabase'
import { getAuthSupabase, getServerSupabase } from '@/lib/supabase-server'

type AuthMemberResult =
  | { member: Member; status?: never; error?: never }
  | { member?: never; status: number; error: string }

export function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization')
  if (!header?.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice('bearer '.length).trim()
  return token || null
}

export async function getAuthenticatedMember(
  req: NextRequest,
  requestedMemberId?: string | null
): Promise<AuthMemberResult> {
  const token = getBearerToken(req)
  if (!token) {
    return { status: 401, error: 'ログインが必要です' }
  }

  const authSupabase = getAuthSupabase()
  const { data, error } = await authSupabase.auth.getUser(token)
  if (error || !data.user) {
    return { status: 401, error: 'ログイン情報を確認できませんでした' }
  }

  const supabase = getServerSupabase()
  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('*')
    .eq('auth_user_id', data.user.id)
    .single<Member>()

  if (memberError || !member) {
    return { status: 403, error: '会員情報が見つかりません' }
  }

  if (requestedMemberId && requestedMemberId !== member.id) {
    return { status: 403, error: '本人確認に失敗しました' }
  }

  return { member }
}
