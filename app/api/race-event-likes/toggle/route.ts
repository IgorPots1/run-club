import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type ToggleRaceEventLikeRequestBody = {
  raceEventId?: string | null
}

type RaceEventLikeCountRow = {
  race_event_id: string
}

function isDuplicateRaceEventLikeError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '23505' ||
    Boolean(error.message?.includes('duplicate key value')) ||
    Boolean(error.message?.includes('race_event_likes_pkey'))
  )
}

function isSelfRaceEventLikeError(error: { message?: string | null }) {
  return Boolean(error.message?.includes('cannot_like_own_race_event'))
}

async function loadRaceEventLikeCount(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  raceEventId: string
) {
  const { count, error } = await supabaseAdmin
    .from('race_event_likes')
    .select('race_event_id', { count: 'exact', head: true })
    .eq('race_event_id', raceEventId)

  if (error) {
    throw error
  }

  return Number(count ?? 0)
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

  const body = await request.json().catch(() => null) as ToggleRaceEventLikeRequestBody | null
  const raceEventId = body?.raceEventId?.trim() ?? ''

  if (!raceEventId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_race_event_id',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data: deletedLikes, error: deleteError } = await supabaseAdmin
    .from('race_event_likes')
    .delete()
    .eq('race_event_id', raceEventId)
    .eq('user_id', user.id)
    .select('race_event_id')

  if (deleteError) {
    return NextResponse.json(
      {
        ok: false,
        error: deleteError.message,
      },
      { status: 500 }
    )
  }

  if (((deletedLikes as RaceEventLikeCountRow[] | null) ?? []).length > 0) {
    const likeCount = await loadRaceEventLikeCount(supabaseAdmin, raceEventId)

    return NextResponse.json({
      ok: true,
      liked: false,
      likeCount,
    })
  }

  const { error: insertError } = await supabaseAdmin
    .from('race_event_likes')
    .insert({
      race_event_id: raceEventId,
      user_id: user.id,
    })

  if (insertError) {
    if (isDuplicateRaceEventLikeError(insertError)) {
      const likeCount = await loadRaceEventLikeCount(supabaseAdmin, raceEventId)

      return NextResponse.json({
        ok: true,
        liked: true,
        likeCount,
      })
    }

    if (isSelfRaceEventLikeError(insertError)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'cannot_like_own_race_event',
        },
        { status: 409 }
      )
    }

    return NextResponse.json(
      {
        ok: false,
        error: insertError.message,
      },
      { status: 500 }
    )
  }

  const likeCount = await loadRaceEventLikeCount(supabaseAdmin, raceEventId)

  return NextResponse.json({
    ok: true,
    liked: true,
    likeCount,
  })
}
