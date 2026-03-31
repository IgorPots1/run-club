import { NextResponse } from 'next/server'
import { createUserShoe, listUserShoes, type UserShoeInput } from '@/lib/shoes'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type CreateUserShoeRequestBody = {
  shoeModelId?: string | null
  customName?: string | null
  nickname?: string | null
  currentDistanceMeters?: number | null
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
    const shoes = await listUserShoes(user.id)

    return NextResponse.json({
      ok: true,
      shoes,
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
