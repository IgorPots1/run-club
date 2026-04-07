import { NextResponse } from 'next/server'
import { listShoeCatalog } from '@/lib/shoes'
import { getAuthenticatedUser } from '@/lib/supabase-server'

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
    const catalog = await listShoeCatalog()

    return NextResponse.json({
      ok: true,
      catalog,
    })
  } catch (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError instanceof Error ? loadError.message : 'shoe_catalog_load_failed',
      },
      { status: 500 }
    )
  }
}
