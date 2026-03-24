import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { COACH_USER_ID } from '@/lib/constants'

function isDirectCoachThreadUniqueError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '23505' ||
    Boolean(error.message?.includes('chat_threads_direct_coach_unique_idx'))
  )
}

async function ensureDirectCoachThreadMembers(threadId: string, studentUserId: string) {
  const supabaseAdmin = createSupabaseAdminClient()

  const membersResult = await supabaseAdmin
    .from('chat_thread_members')
    .upsert(
      [
        {
          thread_id: threadId,
          user_id: studentUserId,
          role: 'member',
        },
        {
          thread_id: threadId,
          user_id: COACH_USER_ID,
          role: 'coach',
        },
      ],
      {
        onConflict: 'thread_id,user_id',
        ignoreDuplicates: false,
      }
    )

  if (membersResult.error) {
    throw membersResult.error
  }
}

export async function POST(request: Request) {
  const { user, error: userError } = await getAuthenticatedUser()

  if (userError || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: userError?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  if (user.id !== COACH_USER_ID) {
    return NextResponse.json(
      {
        ok: false,
        error: 'coach_only',
      },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null) as
    | {
        studentUserId?: string
      }
    | null

  const studentUserId = body?.studentUserId?.trim()

  if (!studentUserId || studentUserId === COACH_USER_ID) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_student_user_id',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()

  const existingThreadResult = await supabaseAdmin
    .from('chat_threads')
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'direct_coach')
    .eq('owner_user_id', studentUserId)
    .eq('coach_user_id', COACH_USER_ID)
    .maybeSingle()

  if (existingThreadResult.error) {
    return NextResponse.json(
      {
        ok: false,
        error: existingThreadResult.error.message,
      },
      { status: 500 }
    )
  }

  if (existingThreadResult.data) {
    try {
      await ensureDirectCoachThreadMembers(existingThreadResult.data.id, studentUserId)

      return NextResponse.json({
        ok: true,
        thread: existingThreadResult.data,
      })
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : 'membership_upsert_failed',
        },
        { status: 500 }
      )
    }
  }

  const createdThreadResult = await supabaseAdmin
    .from('chat_threads')
    .insert({
      type: 'direct_coach',
      owner_user_id: studentUserId,
      coach_user_id: COACH_USER_ID,
    })
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .single()

  if (createdThreadResult.error) {
    if (isDirectCoachThreadUniqueError(createdThreadResult.error)) {
      const refetchedThreadResult = await supabaseAdmin
        .from('chat_threads')
        .select('id, type, title, owner_user_id, coach_user_id, created_at')
        .eq('type', 'direct_coach')
        .eq('owner_user_id', studentUserId)
        .eq('coach_user_id', COACH_USER_ID)
        .maybeSingle()

      if (!refetchedThreadResult.error && refetchedThreadResult.data) {
        try {
          await ensureDirectCoachThreadMembers(refetchedThreadResult.data.id, studentUserId)

          return NextResponse.json({
            ok: true,
            thread: refetchedThreadResult.data,
          })
        } catch (error) {
          return NextResponse.json(
            {
              ok: false,
              error: error instanceof Error ? error.message : 'membership_upsert_failed',
            },
            { status: 500 }
          )
        }
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: createdThreadResult.error.message,
      },
      { status: 500 }
    )
  }

  try {
    await ensureDirectCoachThreadMembers(createdThreadResult.data.id, studentUserId)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'membership_upsert_failed',
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    thread: createdThreadResult.data,
  })
}
