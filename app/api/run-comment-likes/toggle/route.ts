import { NextResponse } from 'next/server'
import {
  parseToggleRunCommentLikeInput,
  toggleRunCommentLikeRecord,
} from '@/lib/server/run-comment-likes'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

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

  const body = await request.json().catch(() => null)
  const parsedInput = parseToggleRunCommentLikeInput(body)

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
  const result = await toggleRunCommentLikeRecord({
    supabaseAdmin,
    commentId: parsedInput.data.commentId,
    userId: user.id,
    likedByMe: parsedInput.data.likedByMe,
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

  return NextResponse.json({
    ok: true,
    runId: result.data.runId,
  })
}
