import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { getProfileDisplayName } from '@/lib/profiles'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { grantChallengeAccessAction, revokeChallengeAccessAction } from '../actions'

type ChallengeDetailsPageProps = {
  params: Promise<{
    id: string
  }>
  searchParams?: Promise<{
    error?: string
  }>
}

type ChallengeRow = {
  id: string
  title: string
  visibility: string | null
  xp_reward: number | null
  goal_km: number | null
  goal_runs: number | null
}

type ChallengeAccessRow = {
  user_id: string
  profiles:
    | {
        id: string
        name?: string | null
        nickname?: string | null
        email?: string | null
      }
    | {
        id: string
        name?: string | null
        email?: string | null
      }
    | null
}

function normalizeChallengeAccessRows(data: unknown): ChallengeAccessRow[] {
  if (!Array.isArray(data)) {
    return []
  }

  return data.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const userId = 'user_id' in item && typeof item.user_id === 'string'
      ? item.user_id
      : null

    if (!userId) {
      return []
    }

    const rawProfiles = 'profiles' in item ? item.profiles : null
    const rawProfile = Array.isArray(rawProfiles)
      ? rawProfiles[0] ?? null
      : rawProfiles && typeof rawProfiles === 'object'
        ? rawProfiles
        : null

    const profile = rawProfile && typeof rawProfile === 'object'
      ? {
          id: 'id' in rawProfile && typeof rawProfile.id === 'string' ? rawProfile.id : userId,
          name: 'name' in rawProfile && typeof rawProfile.name === 'string' ? rawProfile.name : null,
          nickname: 'nickname' in rawProfile && typeof rawProfile.nickname === 'string' ? rawProfile.nickname : null,
          email: 'email' in rawProfile && typeof rawProfile.email === 'string' ? rawProfile.email : null,
        }
      : null

    return [{
      user_id: userId,
      profiles: profile,
    }]
  })
}

function formatNullableValue(value: number | string | null | undefined) {
  return value == null || value === '' ? '—' : String(value)
}

function isMissingNicknameColumnError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    Boolean(error.message?.includes('profiles.nickname')) ||
    Boolean(error.message?.includes("'nickname' column of 'profiles'"))
  )
}

export default async function AdminChallengeDetailsPage({
  params,
  searchParams,
}: ChallengeDetailsPageProps) {
  await requireAdmin()

  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ? searchParams : Promise.resolve(undefined),
  ])
  const error = resolvedSearchParams?.error?.trim() || ''
  const supabase = createSupabaseAdminClient()
  const { data: challenge, error: challengeError } = await supabase
    .from('challenges')
    .select('id, title, visibility, xp_reward, goal_km, goal_runs')
    .eq('id', id)
    .maybeSingle()

  if (challengeError) {
    throw challengeError
  }

  const challengeRow = (challenge as ChallengeRow | null) ?? null

  if (!challengeRow) {
    notFound()
  }

  const primaryAccessResult = await supabase
    .from('challenge_access_users')
    .select('user_id, profiles!challenge_access_users_user_id_fkey(id, name, nickname, email)')
    .eq('challenge_id', challengeRow.id)
    .order('created_at', { ascending: true })

  let accessRows: ChallengeAccessRow[] = []

  if (primaryAccessResult.error) {
    if (!isMissingNicknameColumnError(primaryAccessResult.error)) {
      throw primaryAccessResult.error
    }

    const fallbackAccessResult = await supabase
      .from('challenge_access_users')
      .select('user_id, profiles!challenge_access_users_user_id_fkey(id, name, email)')
      .eq('challenge_id', challengeRow.id)
      .order('created_at', { ascending: true })

    if (fallbackAccessResult.error) {
      throw fallbackAccessResult.error
    }

    accessRows = normalizeChallengeAccessRows(fallbackAccessResult.data)
  } else {
    accessRows = normalizeChallengeAccessRows(primaryAccessResult.data)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/admin/challenges" className="text-sm underline">
            Back to challenges
          </Link>
          <h1 className="text-2xl font-semibold">{challengeRow.title}</h1>
        </div>
        <Link href={`/admin/challenges/${challengeRow.id}/edit`} className="text-sm underline">
          Edit
        </Link>
      </div>

      <div className="rounded border p-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium">Visibility</dt>
            <dd>{formatNullableValue(challengeRow.visibility)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">XP reward</dt>
            <dd>{formatNullableValue(challengeRow.xp_reward)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Goal km</dt>
            <dd>{formatNullableValue(challengeRow.goal_km)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Goal runs</dt>
            <dd>{formatNullableValue(challengeRow.goal_runs)}</dd>
          </div>
        </dl>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {challengeRow.visibility === 'restricted' ? (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Grant access</h2>
            <form action={grantChallengeAccessAction} className="space-y-3 rounded border p-4">
              <input type="hidden" name="challenge_id" value={challengeRow.id} />
              <div className="space-y-1">
                <label htmlFor="user_id" className="block text-sm font-medium">
                  User ID
                </label>
                <input
                  id="user_id"
                  name="user_id"
                  type="text"
                  required
                  className="w-full rounded border px-3 py-2"
                />
              </div>
              <button type="submit" className="rounded border px-3 py-2 text-sm">
                Grant access
              </button>
            </form>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Current access</h2>
            {accessRows.length === 0 ? (
              <div className="rounded border p-4 text-sm text-gray-600">
                No users have access yet.
              </div>
            ) : (
              <div className="space-y-3">
                {accessRows.map((accessRow) => (
                  <div
                    key={accessRow.user_id}
                    className="flex items-center justify-between gap-4 rounded border p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {getProfileDisplayName(accessRow.profiles, accessRow.user_id)}
                      </p>
                      <p className="text-sm text-gray-600">{accessRow.user_id}</p>
                    </div>
                    <form action={revokeChallengeAccessAction}>
                      <input type="hidden" name="challenge_id" value={challengeRow.id} />
                      <input type="hidden" name="user_id" value={accessRow.user_id} />
                      <button type="submit" className="rounded border px-3 py-2 text-sm">
                        Remove
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
