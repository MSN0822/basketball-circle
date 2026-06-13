import { describe, expect, it } from 'vitest'
import { publishDueDraftEvents } from '@/lib/event-publishing'
import { mockSupabaseFrom } from './helpers/mock-supabase'

describe('event publishing helpers', () => {
  it('promotes due drafts to accepting events', async () => {
    const supabase = mockSupabaseFrom()
    const now = new Date('2026-06-08T00:00:00.000Z')

    await publishDueDraftEvents(supabase.client, now)

    expect(supabase.spies.update).toHaveBeenCalledWith({
      status: 'accepting',
      is_manual_close: false,
    })
    expect(supabase.spies.updateEq).toHaveBeenCalledWith('status', 'draft')
    expect(supabase.spies.updateNot).toHaveBeenCalledWith('publishes_at', 'is', null)
    expect(supabase.spies.updateLte).toHaveBeenCalledWith('publishes_at', now.toISOString())
  })
})
