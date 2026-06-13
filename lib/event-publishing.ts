import type { SupabaseClient } from '@supabase/supabase-js'

export async function publishDueDraftEvents(supabase: SupabaseClient, now = new Date()): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({ status: 'accepting', is_manual_close: false })
    .eq('status', 'draft')
    .not('publishes_at', 'is', null)
    .lte('publishes_at', now.toISOString())

  if (error) throw new Error(error.message)
}
