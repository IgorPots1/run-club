import { NextResponse } from 'next/server'
import {
  buildRunCommentPayload,
  createRunCommentRecord,
  parseCreateRunCommentInput,
} from '@/lib/server/run-comments'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
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

  const { id } = await context.params
  const raceId = typeof id === 'string' ? id.trim() : ''

  if (!raceId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_race_id',
      },
      { status: 400 }
    )
  }

  const body = await request.json().catch(() => null)
  const parsedInput = parseCreateRunCommentInput(body)

  if (!parsedInput.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: parsedInput.error,
      },
      { status: parsedInput.status }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const result = await createRunCommentRecord({
    supabaseAdmin,
    entityType: 'race',
    entityId: raceId,
    userId: user.id,
    comment: parsedInput.data.comment,
    parentId: parsedInput.data.parentId,
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
      },
      { status: result.status }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      comment: await buildRunCommentPayload({
        supabaseAdmin,
        comment: result.data,
        viewerUserId: user.id,
      }),
    },
    { status: 201 }
  )
}
