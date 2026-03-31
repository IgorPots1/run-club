import { NextResponse } from 'next/server'
import { searchShoeModels } from '@/lib/shoes'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim() ?? ''

  try {
    const models = await searchShoeModels(query)

    return NextResponse.json({
      ok: true,
      models,
    })
  } catch (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError instanceof Error ? loadError.message : 'shoe_models_load_failed',
      },
      { status: 500 }
    )
  }
}
