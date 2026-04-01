import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'
import { getLevelFromXP } from './xp'

type RefreshProfileTotalXpOptions = {
  supabase?: ReturnType<typeof createSupabaseAdminClient>
  context?: string
  strict?: boolean
}

type LoadProfileTotalXpOptions = {
  supabase?: ReturnType<typeof createSupabaseAdminClient>
}

export async function loadProfileTotalXp(userId: string, options: LoadProfileTotalXpOptions = {}) {
  const supabase = options.supabase ?? createSupabaseAdminClient()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('total_xp')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return Math.max(0, Math.round(Number((profile as { total_xp?: number | null } | null)?.total_xp ?? 0)))
}

export async function refreshProfileTotalXp(userId: string, options: RefreshProfileTotalXpOptions = {}) {
  const supabase = options.supabase ?? createSupabaseAdminClient()

  try {
    const oldTotalXp = await loadProfileTotalXp(userId, { supabase })
    const { data, error: recalculateError } = await supabase.rpc('recalculate_user_total_xp', {
      p_user_id: userId,
    })

    if (recalculateError) {
      throw recalculateError
    }

    const totalXp = Number.isFinite(Number(data)) ? Number(data) : 0
    const oldLevel = getLevelFromXP(oldTotalXp).level
    const newLevel = getLevelFromXP(totalXp).level
    const levelUp = newLevel > oldLevel

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
      levelUp,
      newLevel: levelUp ? newLevel : null,
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
      levelUp: false,
      newLevel: null,
      error,
    }
  }
}
