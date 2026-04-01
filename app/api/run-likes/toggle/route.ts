import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import {
  DAILY_XP_CAP,
  loadDailyXpUsage,
  MAX_LIKES_WITH_XP_PER_DAY,
  XP_PER_LIKE,
} from '@/lib/xp-anti-abuse'

type ToggleRunLikeRequestBody = {
  runId?: string | null
  likedByMe?: boolean | null
}

type RunOwnerRow = {
  user_id: string
}

type RunLikeMutationRow = {
  created_at: string
}

function getAwardedLikeXp(receivedLikesCount: number) {
  const normalizedCount = Math.max(0, Math.round(Number(receivedLikesCount)))
  return Math.min(normalizedCount, MAX_LIKES_WITH_XP_PER_DAY) * XP_PER_LIKE
}

function getCappedDailyTotalXp(runXp: number, challengeXp: number, receivedLikesCount: number) {
  const normalizedRunXp = Math.max(0, Math.round(Number(runXp)))
  const normalizedChallengeXp = Math.max(0, Math.round(Number(challengeXp)))
  const likeXp = getAwardedLikeXp(receivedLikesCount)
  return Math.min(normalizedRunXp + normalizedChallengeXp + likeXp, DAILY_XP_CAP)
}

function isDuplicateRunLikeError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '23505' ||
    Boolean(error.message?.includes('duplicate key value')) ||
    Boolean(error.message?.includes('run_likes_pkey'))
  )
}

async function applyProfileTotalXpDelta(
  userId: string,
  xpDelta: number,
  supabase = createSupabaseAdminClient()
) {
  if (xpDelta === 0) {
    return
  }

  const { error } = await supabase.rpc('apply_profile_total_xp_delta', {
    p_user_id: userId,
    p_xp_delta: xpDelta,
  })

  if (error) {
    throw error
  }
}

export async function POST(request: Request) {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  const body = await request.json().catch(() => null) as ToggleRunLikeRequestBody | null
  const runId = body?.runId?.trim() ?? ''
  const likedByMe = body?.likedByMe === true

  if (!runId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_run_id',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data: runOwner, error: runOwnerError } = await supabaseAdmin
    .from('runs')
    .select('user_id')
    .eq('id', runId)
    .maybeSingle()

  if (runOwnerError) {
    return NextResponse.json(
      {
        ok: false,
        error: runOwnerError.message,
      },
      { status: 500 }
    )
  }

  const ownerUserId = (runOwner as RunOwnerRow | null)?.user_id ?? null

  if (!ownerUserId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'run_not_found',
      },
      { status: 404 }
    )
  }

  let xpGained = 0
  let xpRemoved = 0

  if (likedByMe) {
    const { data: deletedLikes, error: deleteError } = await supabaseAdmin
      .from('run_likes')
      .delete()
      .eq('run_id', runId)
      .eq('user_id', user.id)
      .select('created_at')

    if (deleteError) {
      return NextResponse.json(
        {
          ok: false,
          error: deleteError.message,
        },
        { status: 500 }
      )
    }

    const deletedLike = ((deletedLikes as RunLikeMutationRow[] | null) ?? [])[0] ?? null

    if (!deletedLike?.created_at) {
      return NextResponse.json({
        ok: true,
        xpGained: 0,
        xpRemoved: 0,
        breakdown: [],
      })
    }

    const dailyXpUsage = await loadDailyXpUsage({
      userId: ownerUserId,
      timestamp: deletedLike.created_at,
      supabase: supabaseAdmin,
    })
    const dailyXpBeforeRemoval = getCappedDailyTotalXp(
      dailyXpUsage.runXp,
      dailyXpUsage.challengeXp,
      dailyXpUsage.receivedLikesCount + 1
    )
    const dailyXpAfterRemoval = getCappedDailyTotalXp(
      dailyXpUsage.runXp,
      dailyXpUsage.challengeXp,
      dailyXpUsage.receivedLikesCount
    )

    xpRemoved = Math.max(0, dailyXpBeforeRemoval - dailyXpAfterRemoval)
    await applyProfileTotalXpDelta(ownerUserId, -xpRemoved, supabaseAdmin)
  } else {
    const { data: insertedLikes, error: insertError } = await supabaseAdmin
      .from('run_likes')
      .insert({ run_id: runId, user_id: user.id })
      .select('created_at')

    if (insertError) {
      if (isDuplicateRunLikeError(insertError)) {
        return NextResponse.json({
          ok: true,
          xpGained: 0,
          xpRemoved: 0,
          breakdown: [],
        })
      }

      return NextResponse.json(
        {
          ok: false,
          error: insertError.message,
        },
        { status: 500 }
      )
    }

    const insertedLike = ((insertedLikes as RunLikeMutationRow[] | null) ?? [])[0] ?? null

    if (!insertedLike?.created_at) {
      return NextResponse.json({
        ok: true,
        xpGained: 0,
        xpRemoved: 0,
        breakdown: [],
      })
    }

    const dailyXpUsage = await loadDailyXpUsage({
      userId: ownerUserId,
      timestamp: insertedLike.created_at,
      supabase: supabaseAdmin,
    })
    const dailyXpBeforeInsert = getCappedDailyTotalXp(
      dailyXpUsage.runXp,
      dailyXpUsage.challengeXp,
      dailyXpUsage.receivedLikesCount - 1
    )
    const dailyXpAfterInsert = getCappedDailyTotalXp(
      dailyXpUsage.runXp,
      dailyXpUsage.challengeXp,
      dailyXpUsage.receivedLikesCount
    )

    xpGained = Math.max(0, dailyXpAfterInsert - dailyXpBeforeInsert)
    await applyProfileTotalXpDelta(ownerUserId, xpGained, supabaseAdmin)
  }

  return NextResponse.json({
    ok: true,
    xpGained,
    xpRemoved,
    breakdown: xpGained > 0 ? [{ label: 'Лайк', value: xpGained }] : [],
  })
}
