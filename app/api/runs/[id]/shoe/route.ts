import { NextResponse } from 'next/server'
import { getUserShoeByIdWithAdminAccess, toUserShoeSummary } from '@/lib/shoes'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type VisibleRunRow = {
  id: string
  user_id: string
  shoe_id: string | null
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { user, error, supabase } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  const { id: runId } = await context.params
  const { data: visibleRun, error: runError } = await supabase
    .from('runs')
    .select('id, user_id, shoe_id')
    .eq('id', runId)
    .maybeSingle()

  if (runError) {
    return NextResponse.json(
      {
        ok: false,
        error: runError.message,
      },
      { status: 500 }
    )
  }

  const run = (visibleRun as VisibleRunRow | null) ?? null

  if (!run) {
    return NextResponse.json(
      {
        ok: false,
        error: 'run_not_found',
      },
      { status: 404 }
    )
  }

  if (!run.shoe_id) {
    return NextResponse.json({
      ok: true,
      shoe: null,
    })
  }

  try {
    const shoe = await getUserShoeByIdWithAdminAccess(run.user_id, run.shoe_id)

    return NextResponse.json({
      ok: true,
      shoe: shoe ? toUserShoeSummary(shoe) : null,
    })
  } catch (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError instanceof Error ? loadError.message : 'run_shoe_load_failed',
      },
      { status: 500 }
    )
  }
}
