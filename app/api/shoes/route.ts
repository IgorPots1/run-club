import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createUserShoe, listUserShoes, type UserShoeInput } from '@/lib/shoes'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type CreateUserShoeRequestBody = {
  shoeModelId?: string | null
  customName?: string | null
  nickname?: string | null
  currentDistanceMeters?: number | null
  maxDistanceMeters?: number | null
  isActive?: boolean | null
}

export async function GET() {
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

  try {
    const [shoes, lastUsedRunResult] = await Promise.all([
      listUserShoes(user.id),
      createSupabaseAdminClient()
        .from('runs')
        .select('shoe_id')
        .eq('user_id', user.id)
        .not('shoe_id', 'is', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (lastUsedRunResult.error) {
      throw lastUsedRunResult.error
    }

    const mostRecentlyUsedShoeId =
      typeof lastUsedRunResult.data?.shoe_id === 'string' && lastUsedRunResult.data.shoe_id.trim().length > 0
        ? lastUsedRunResult.data.shoe_id
        : null

    return NextResponse.json({
      ok: true,
      shoes,
      mostRecentlyUsedShoeId,
    })
  } catch (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError instanceof Error ? loadError.message : 'user_shoes_load_failed',
      },
      { status: 500 }
    )
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

  const body = await request.json().catch(() => null) as CreateUserShoeRequestBody | null

  const input: UserShoeInput = {
    shoeModelId: body?.shoeModelId ?? null,
    customName: body?.customName ?? null,
    nickname: body?.nickname ?? null,
    currentDistanceMeters: Number(body?.currentDistanceMeters ?? 0),
    maxDistanceMeters: body?.maxDistanceMeters ?? null,
    isActive: body?.isActive ?? true,
  }

  try {
    const shoe = await createUserShoe(user.id, input)

    return NextResponse.json(
      {
        ok: true,
        shoe,
      },
      { status: 201 }
    )
  } catch (createError) {
    const errorMessage = createError instanceof Error ? createError.message : 'user_shoe_create_failed'
    const status = (
      errorMessage === 'shoe_model_id_or_custom_name_required' ||
      errorMessage === 'current_distance_meters_must_be_non_negative' ||
      errorMessage === 'max_distance_meters_must_be_positive' ||
      errorMessage === 'is_active_must_be_boolean'
    )
      ? 400
      : 500

    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
      },
      { status }
    )
  }
}
