import { NextRequest, NextResponse } from 'next/server'
import { Member } from '@/lib/supabase'
import { getBearerUser } from '@/lib/api-auth'
import { getServerSupabase } from '@/lib/supabase-server'
import { isValidUuid } from '@/lib/validators'

const supabase = getServerSupabase()
const MAX_NAME_LENGTH = 100

type RegisterMemberResult = {
  error?: string
  status?: number
  member?: Member
}

type UpdateMemberNameResult = {
  error?: string
  status?: number
  member?: Member
}

type RpcError = {
  code?: string
  message?: string
}

function shouldFallbackToLegacyRegister(error: RpcError): boolean {
  return error.code === 'PGRST202' || Boolean(error.message?.includes('register_member'))
}

async function legacyRegister(name: string, authUserId: string) {
  const { data: latest } = await supabase
    .from('members')
    .select('member_number')
    .order('member_number', { ascending: false })
    .limit(1)
    .single<Member>()

  const nextNum = latest ? parseInt(latest.member_number) + 1 : 1
  const memberNumber = String(nextNum).padStart(3, '0')

  const { data, error } = await supabase
    .from('members')
    .insert({ name, member_number: memberNumber, auth_user_id: authUserId })
    .select()
    .single<Member>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: data })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { name?: unknown; auth_user_id?: unknown } | null
  if (!body) {
    return NextResponse.json({ error: 'name と auth_user_id は必須です' }, { status: 400 })
  }

  const { name, auth_user_id } = body
  const trimmedName = typeof name === 'string' ? name.trim() : ''

  if (!trimmedName || typeof auth_user_id !== 'string' || !auth_user_id) {
    return NextResponse.json({ error: 'name と auth_user_id は必須です' }, { status: 400 })
  }
  if (trimmedName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: `name は ${MAX_NAME_LENGTH} 文字以内で入力してください` }, { status: 400 })
  }

  const user = await getBearerUser(req)
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }
  if (user.id !== auth_user_id) {
    return NextResponse.json({ error: '本人確認に失敗しました' }, { status: 403 })
  }

  const { data, error } = await supabase.rpc('register_member', {
    p_name: trimmedName,
    p_auth_user_id: auth_user_id,
  })

  if (error) {
    if (shouldFallbackToLegacyRegister(error)) {
      return legacyRegister(trimmedName, auth_user_id)
    }
    if (error.code === '23503') {
      return NextResponse.json({ error: 'auth_user_id が正しくありません' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const result = data as RegisterMemberResult | null
  if (!result) {
    return NextResponse.json({ error: '会員情報の登録に失敗しました' }, { status: 500 })
  }
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }

  return NextResponse.json({ member: result.member })
}

export async function PATCH(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { member_id?: unknown; name?: unknown } | null
  if (!body) {
    return NextResponse.json({ error: 'member_id と name は必須です' }, { status: 400 })
  }

  const { member_id, name } = body
  const trimmedName = typeof name === 'string' ? name.trim() : ''

  if (typeof member_id !== 'string' || !member_id || !trimmedName) {
    return NextResponse.json({ error: 'member_id と name は必須です' }, { status: 400 })
  }
  if (!isValidUuid(member_id)) {
    return NextResponse.json({ error: 'member_id の形式が正しくありません' }, { status: 400 })
  }
  if (trimmedName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: `name は ${MAX_NAME_LENGTH} 文字以内で入力してください` }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('update_member_name', {
    p_member_id: member_id,
    p_auth_user_id: user.id,
    p_name: trimmedName,
  })

  if (error) {
    if (error.code === 'PGRST202' || error.message?.includes('update_member_name')) {
      return NextResponse.json({ error: '会員名更新RPCが未適用です' }, { status: 500 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const result = data as UpdateMemberNameResult | null
  if (!result) {
    return NextResponse.json({ error: '会員情報の更新に失敗しました' }, { status: 500 })
  }
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }

  return NextResponse.json({ member: result.member })
}
