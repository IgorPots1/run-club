import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'

type RefreshProfileTotalXpOptions = {
  supabase?: ReturnType<typeof createSupabaseAdminClient>
  context?: string
  strict?: boolean
}

export async function refreshProfileTotalXp(userId: string, options: RefreshProfileTotalXpOptions = {}) {
  const supabase = options.supabase ?? createSupabaseAdminClient()

  try {
    const { data, error: recalculateError } = await supabase.rpc('recalculate_user_total_xp', {
      p_user_id: userId,
    })

    if (recalculateError) {
      throw recalculateError
    }

    const totalXp = Number.isFinite(Number(data)) ? Number(data) : 0

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ total_xp: totalXp })
      .eq('id', userId)

    if (updateError) {
      throw updateError
    }

    return {
      ok: true as const,
      totalXp,
      error: null,
    }
  } catch (error) {
    console.error('[profile-total-xp] failed to refresh profile total xp', {
      userId,
      context: options.context ?? null,
      error,
    })

    if (options.strict) {
      throw error
    }

    return {
      ok: false as const,
      totalXp: null,
      error,
    }
  }
}
