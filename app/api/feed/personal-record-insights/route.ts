import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

const MAX_RUN_IDS = 100
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type PersonalRecordInsightRequestBody = {
  runIds?: unknown
}

type PersonalRecordInsightRow = {
  run_id: string | null
  distance_meters: number | null
}

type EligibleRunRow = {
  id: string | null
  user_id: string | null
}

type ActiveProfileRow = {
  id: string | null
}

function normalizeRunIds(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  const uniqueRunIds = new Set<string>()

  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }

    const normalized = item.trim()
    if (!UUID_PATTERN.test(normalized)) {
      continue
    }

    uniqueRunIds.add(normalized)

    if (uniqueRunIds.size >= MAX_RUN_IDS) {
      break
    }
  }

  return [...uniqueRunIds]
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as PersonalRecordInsightRequestBody | null
  const runIds = normalizeRunIds(body?.runIds)

  if (runIds.length === 0) {
    return NextResponse.json({
      items: [],
    })
  }

  const supabaseAdmin = createSupabaseAdminClient()

  const { data: visibleRuns, error: visibleRunsError } = await supabaseAdmin
    .from('runs')
    .select('id, user_id')
    .in('id', runIds)

  if (visibleRunsError) {
    console.error('[feed] failed to load visible runs for personal record insights', visibleRunsError)

    return NextResponse.json(
      {
        error: 'personal_record_insights_load_failed',
      },
      { status: 500 }
    )
  }

  const visibleRunRows = ((visibleRuns as EligibleRunRow[] | null) ?? []).flatMap((row) => {
    const runId = typeof row.id === 'string' ? row.id.trim() : ''
    const userId = typeof row.user_id === 'string' ? row.user_id.trim() : ''

    return runId && userId
      ? [{
          id: runId,
          userId,
        }]
      : []
  })

  if (visibleRunRows.length === 0) {
    return NextResponse.json({
      items: [],
    })
  }

  const { data: activeProfiles, error: activeProfilesError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .in('id', Array.from(new Set(visibleRunRows.map((row) => row.userId))))
    .eq('app_access_status', 'active')

  if (activeProfilesError) {
    console.error('[feed] failed to load active profiles for personal record insights', activeProfilesError)

    return NextResponse.json(
      {
        error: 'personal_record_insights_load_failed',
      },
      { status: 500 }
    )
  }

  const activeUserIds = new Set(
    ((activeProfiles as ActiveProfileRow[] | null) ?? []).flatMap((row) => {
      const profileId = typeof row.id === 'string' ? row.id.trim() : ''
      return profileId ? [profileId] : []
    })
  )

  const eligibleRunIds = visibleRunRows.flatMap((row) => (
    activeUserIds.has(row.userId) ? [row.id] : []
  ))

  if (eligibleRunIds.length === 0) {
    return NextResponse.json({
      items: [],
    })
  }

  const { data, error } = await supabaseAdmin
    .from('personal_records')
    .select('run_id, distance_meters')
    .in('run_id', eligibleRunIds)

  if (error) {
    console.error('[feed] failed to load canonical personal record insights', error)

    return NextResponse.json(
      {
        error: 'personal_record_insights_load_failed',
      },
      { status: 500 }
    )
  }

  const items = ((data as PersonalRecordInsightRow[] | null) ?? []).flatMap((row) => {
    const runId = typeof row.run_id === 'string' ? row.run_id.trim() : ''
    const distanceMeters = Number(row.distance_meters)

    if (!runId || !Number.isFinite(distanceMeters) || distanceMeters <= 0) {
      return []
    }

    return [{
      runId,
      distanceMeters: Math.round(distanceMeters),
    }]
  })

  return NextResponse.json({ items })
}
