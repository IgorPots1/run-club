import { NextResponse } from 'next/server'
import { getUserShoeById, updateUserShoe, type UserShoeInput } from '@/lib/shoes'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type UpdateUserShoeRequestBody = {
  shoeModelId?: string | null
  shoeVersionId?: string | null
  customName?: string | null
  nickname?: string | null
  currentDistanceMeters?: number | null
  maxDistanceMeters?: number | null
  isActive?: boolean | null
}

export async function PATCH(
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

  const { id: shoeId } = await context.params
  const existingShoe = await getUserShoeById(user.id, shoeId)

  if (!existingShoe) {
    return NextResponse.json(
      {
        ok: false,
        error: 'shoe_not_found',
      },
      { status: 404 }
    )
  }

  const body = await request.json().catch(() => null) as UpdateUserShoeRequestBody | null
  const input: UserShoeInput = {
    shoeModelId: body?.shoeModelId ?? existingShoe.shoeModelId,
    shoeVersionId: body?.shoeVersionId ?? existingShoe.shoeVersionId,
    customName: body?.customName ?? existingShoe.customName,
    nickname: body?.nickname ?? existingShoe.nickname,
    currentDistanceMeters: Number(body?.currentDistanceMeters ?? existingShoe.currentDistanceMeters),
    maxDistanceMeters: body?.maxDistanceMeters ?? existingShoe.maxDistanceMeters,
    isActive: body?.isActive ?? existingShoe.isActive,
  }

  try {
    const shoe = await updateUserShoe(user.id, shoeId, input)

    if (!shoe) {
      return NextResponse.json(
        {
          ok: false,
          error: 'shoe_not_found',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ok: true,
      shoe,
    })
  } catch (updateError) {
    const errorMessage = updateError instanceof Error ? updateError.message : 'user_shoe_update_failed'
    const status = (
      errorMessage === 'shoe_version_id_or_shoe_model_id_or_custom_name_required' ||
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
