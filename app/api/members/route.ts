import { NextRequest, NextResponse } from 'next/server'
import { Member } from '@/lib/supabase'
import { getBearerUser } from '@/lib/api-auth'
import { getServerSupabase } from '@/lib/supabase-server'

const supabase = getServerSupabase()

type RegisterMemberResult = {
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
  const { name, auth_user_id } = await req.json()
  const trimmedName = name?.trim()

  if (!trimmedName || !auth_user_id) {
    return NextResponse.json({ error: 'name と auth_user_id は必須です' }, { status: 400 })
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

  const { member_id, name } = await req.json()
  const trimmedName = name?.trim()

  if (!member_id || !trimmedName) {
    return NextResponse.json({ error: 'member_id と name は必須です' }, { status: 400 })
  }

  const { data, error: memberError } = await supabase
    .from('members')
    .update({ name: trimmedName })
    .eq('id', member_id)
    .eq('auth_user_id', user.id)
    .select('*')
    .single<Member>()

  if (memberError || !data) {
    return NextResponse.json(
      { error: memberError?.message ?? '会員情報の更新に失敗しました' },
      { status: 500 }
    )
  }

  const { error: participantsError } = await supabase
    .from('participants')
    .update({ name: trimmedName })
    .eq('member_id', member_id)
    .in('status', ['active', 'waitlist'])

  if (participantsError) {
    return NextResponse.json({ error: participantsError.message }, { status: 500 })
  }

  return NextResponse.json({ member: data })
}
