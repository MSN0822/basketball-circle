import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Member } from '@/lib/supabase'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { name, auth_user_id } = await req.json()

  if (!name?.trim() || !auth_user_id) {
    return NextResponse.json({ error: 'name と auth_user_id は必須です' }, { status: 400 })
  }

  const { data: latest } = await supabase
    .from('members')
    .select('member_number')
    .order('member_number', { ascending: false })
    .limit(1)
    .single<Member>()

  const nextNum = latest ? parseInt(latest.member_number) + 1 : 1
  const member_number = String(nextNum).padStart(3, '0')

  const { data, error } = await supabase
    .from('members')
    .insert({ name: name.trim(), member_number, auth_user_id })
    .select()
    .single<Member>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: data })
}
