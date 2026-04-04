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

function formatVisibility(value: string | null | undefined) {
  if (value === 'public') return 'Открытый'
  if (value === 'restricted') return 'По доступу'
  return formatNullableValue(value)
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
          <Link href="/admin/challenges" className="app-text-secondary text-sm underline decoration-black/20 underline-offset-4">
            Назад к челленджам
          </Link>
          <h1 className="app-text-primary text-2xl font-bold">{challengeRow.title}</h1>
        </div>
        <Link
          href={`/admin/challenges/${challengeRow.id}/edit`}
          className="app-button-secondary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm"
        >
          Редактировать
        </Link>
      </div>

      <div className="app-card rounded-2xl border p-4 shadow-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="app-text-secondary text-sm">Видимость</dt>
            <dd className="app-text-primary mt-1 font-medium">{formatVisibility(challengeRow.visibility)}</dd>
          </div>
          <div>
            <dt className="app-text-secondary text-sm">Награда XP</dt>
            <dd className="app-text-primary mt-1 font-medium">{formatNullableValue(challengeRow.xp_reward)}</dd>
          </div>
          <div>
            <dt className="app-text-secondary text-sm">Цель по километрам</dt>
            <dd className="app-text-primary mt-1 font-medium">{formatNullableValue(challengeRow.goal_km)}</dd>
          </div>
          <div>
            <dt className="app-text-secondary text-sm">Цель по тренировкам</dt>
            <dd className="app-text-primary mt-1 font-medium">{formatNullableValue(challengeRow.goal_runs)}</dd>
          </div>
        </dl>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {challengeRow.visibility === 'restricted' ? (
        <>
          <section className="space-y-3">
            <h2 className="app-text-primary text-lg font-semibold">Выдать доступ</h2>
            <form action={grantChallengeAccessAction} className="app-card space-y-3 rounded-2xl border p-4 shadow-sm">
              <input type="hidden" name="challenge_id" value={challengeRow.id} />
              <div className="space-y-1">
                <label htmlFor="user_id" className="app-text-secondary block text-sm">
                  ID пользователя
                </label>
                <input
                  id="user_id"
                  name="user_id"
                  type="text"
                  required
                  className="app-input w-full rounded-2xl border px-3 py-2"
                />
              </div>
              <button type="submit" className="app-button-primary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm">
                Выдать доступ
              </button>
            </form>
          </section>

          <section className="space-y-3">
            <h2 className="app-text-primary text-lg font-semibold">Текущий доступ</h2>
            {accessRows.length === 0 ? (
              <div className="app-card rounded-2xl border p-4 shadow-sm">
                <p className="app-text-secondary text-sm">Пока никому не выдан доступ.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {accessRows.map((accessRow) => (
                  <div
                    key={accessRow.user_id}
                    className="app-card flex items-center justify-between gap-4 rounded-2xl border p-4 shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="app-text-primary font-medium">
                        {getProfileDisplayName(accessRow.profiles, accessRow.user_id)}
                      </p>
                      <p className="app-text-secondary text-sm">{accessRow.user_id}</p>
                    </div>
                    <form action={revokeChallengeAccessAction}>
                      <input type="hidden" name="challenge_id" value={challengeRow.id} />
                      <input type="hidden" name="user_id" value={accessRow.user_id} />
                      <button type="submit" className="app-button-secondary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm">
                        Убрать
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
