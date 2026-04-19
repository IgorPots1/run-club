import { after, NextResponse } from 'next/server'
import { createAppEvent } from '@/lib/events/createAppEvent'
import { buildRaceEventLikedEvent } from '@/lib/events/returnTriggerEvents'
import { processAppEventPushDeliveries } from '@/lib/push/appEventPush'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type ToggleRaceEventLikeRequestBody = {
  raceEventId?: string | null
}

type RaceEventLikeCountRow = {
  race_event_id: string
}

type RaceEventLikeMutationRow = {
  created_at: string
}

type RaceEventOwnerRow = {
  id: string
  user_id: string | null
  name: string | null
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

async function emitRaceEventLikedNotification(input: {
  actorUserId: string
  raceEventId: string
  likeCreatedAt: string
}) {
  try {
    const supabaseAdmin = createSupabaseAdminClient()
    const { data, error } = await supabaseAdmin
      .from('race_events')
      .select('id, user_id, name')
      .eq('id', input.raceEventId)
      .maybeSingle()

    if (error) {
      throw error
    }

    const raceEvent = (data as RaceEventOwnerRow | null) ?? null

    if (!raceEvent || !raceEvent.user_id || raceEvent.user_id === input.actorUserId) {
      return
    }

    const createdEvent = await createAppEvent(
      buildRaceEventLikedEvent({
        actorUserId: input.actorUserId,
        targetUserId: raceEvent.user_id,
        raceEventId: raceEvent.id,
        likeCreatedAt: input.likeCreatedAt,
        raceName: raceEvent.name,
      })
    )

    await processAppEventPushDeliveries({
      appEventIds: [createdEvent.id],
    })
  } catch (error) {
    console.error('Failed to create race event like app event', {
      raceEventId: input.raceEventId,
      actorUserId: input.actorUserId,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}

async function loadExistingRaceEventLike(input: { raceEventId: string; userId: string }) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
    .from('race_event_likes')
    .select('created_at')
    .eq('race_event_id', input.raceEventId)
    .eq('user_id', input.userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data as RaceEventLikeMutationRow | null) ?? null
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

  const { data: insertedLike, error: insertError } = await supabaseAdmin
    .from('race_event_likes')
    .insert({
      race_event_id: raceEventId,
      user_id: user.id,
    })
    .select('created_at')
    .single()

  if (insertError) {
    if (isDuplicateRaceEventLikeError(insertError)) {
      const existingLike = await loadExistingRaceEventLike({
        raceEventId,
        userId: user.id,
      })
      const likeCount = await loadRaceEventLikeCount(supabaseAdmin, raceEventId)

      if (existingLike?.created_at) {
        after(async () => {
          await emitRaceEventLikedNotification({
            actorUserId: user.id,
            raceEventId,
            likeCreatedAt: existingLike.created_at,
          })
        })
      }

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
  const insertedRaceEventLike = (insertedLike as RaceEventLikeMutationRow | null) ?? null

  if (insertedRaceEventLike?.created_at) {
    after(async () => {
      await emitRaceEventLikedNotification({
        actorUserId: user.id,
        raceEventId,
        likeCreatedAt: insertedRaceEventLike.created_at,
      })
    })
  }

  return NextResponse.json({
    ok: true,
    liked: true,
    likeCount,
  })
}
