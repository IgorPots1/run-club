import { NextResponse } from 'next/server'
import {
  parsePushPreferencesUpdate,
  pickPushPreferences,
  type PushPreferences,
} from '@/lib/notifications/preferences'
import { getUserPushPreferencesForUser } from '@/lib/notifications/userPushPreferences'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type PushPreferencesResponse = {
  ok: true
  preferences: PushPreferences
}

function createAuthRequiredResponse(errorMessage?: string) {
  return NextResponse.json(
    {
      ok: false,
      error: errorMessage ?? 'auth_required',
    },
    { status: 401 }
  )
}

export async function GET() {
  const { user, error, supabase } = await getAuthenticatedUser()

  if (error || !user) {
    return createAuthRequiredResponse(error?.message)
  }

  try {
    const preferences = await getUserPushPreferencesForUser(supabase, user.id)

    return NextResponse.json({
      ok: true,
      preferences: pickPushPreferences(preferences),
    } satisfies PushPreferencesResponse)
  } catch (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError instanceof Error ? loadError.message : 'push_preferences_load_failed',
      },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  const { user, error, supabase } = await getAuthenticatedUser()

  if (error || !user) {
    return createAuthRequiredResponse(error?.message)
  }

  const body = await request.json().catch(() => null)
  const parsedUpdate = parsePushPreferencesUpdate(body)

  if (!parsedUpdate.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: parsedUpdate.error,
      },
      { status: 400 }
    )
  }

  try {
    await getUserPushPreferencesForUser(supabase, user.id)

    const { error: updateError } = await supabase
      .from('user_push_preferences')
      .update(parsedUpdate.value)
      .eq('user_id', user.id)

    if (updateError) {
      throw updateError
    }

    const updatedPreferences = await getUserPushPreferencesForUser(supabase, user.id)

    return NextResponse.json({
      ok: true,
      preferences: pickPushPreferences(updatedPreferences),
    } satisfies PushPreferencesResponse)
  } catch (updateError) {
    return NextResponse.json(
      {
        ok: false,
        error: updateError instanceof Error ? updateError.message : 'push_preferences_update_failed',
      },
      { status: 500 }
    )
  }
}
