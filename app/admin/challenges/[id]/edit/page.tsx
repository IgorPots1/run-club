import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { updateChallengeAction } from '../../actions'
import { ChallengeForm } from '../../ChallengeForm'

type EditChallengePageProps = {
  params: Promise<{
    id: string
  }>
  searchParams?: Promise<{
    error?: string
    title?: string
    description?: string
    visibility?: string
    period_type?: string
    goal_unit?: string
    goal_target?: string
    xp_reward?: string
    starts_at?: string
    end_at?: string
    badge_url?: string
    badge_storage_path?: string
    template_id?: string
  }>
}

type ChallengeRow = {
  id: string
  title: string
  description: string | null
  visibility: string | null
  period_type: 'lifetime' | 'challenge' | 'weekly' | 'monthly' | null
  goal_unit: 'distance_km' | 'run_count' | null
  goal_target: number | null
  starts_at: string | null
  end_at: string | null
  badge_url: string | null
  badge_storage_path: string | null
  goal_km: number | null
  goal_runs: number | null
  xp_reward: number | null
  template_id: string | null
}

export default async function EditChallengePage({
  params,
  searchParams,
}: EditChallengePageProps) {
  const { profile } = await requireAdmin()

  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ? searchParams : Promise.resolve(undefined),
  ])
  const error = resolvedSearchParams?.error?.trim() || ''
  const supabase = createSupabaseAdminClient()
  const { data, error: challengeError } = await supabase
    .from('challenges')
    .select('id, title, description, visibility, period_type, goal_unit, goal_target, starts_at, end_at, badge_url, badge_storage_path, goal_km, goal_runs, xp_reward, template_id')
    .eq('id', id)
    .maybeSingle()

  if (challengeError) {
    throw challengeError
  }

  const challenge = (data as ChallengeRow | null) ?? null

  if (!challenge) {
    notFound()
  }

  const formValues = {
    recordId: challenge.id,
    title: resolvedSearchParams?.title ?? challenge.title,
    description: resolvedSearchParams?.description ?? challenge.description ?? '',
    templateId: resolvedSearchParams?.template_id ?? challenge.template_id ?? '',
    visibility: resolvedSearchParams?.visibility === 'restricted'
      ? 'restricted'
      : challenge.visibility === 'restricted'
        ? 'restricted'
        : 'public',
    periodType:
      resolvedSearchParams?.period_type === 'challenge' ||
      resolvedSearchParams?.period_type === 'weekly' ||
      resolvedSearchParams?.period_type === 'monthly' ||
      resolvedSearchParams?.period_type === 'lifetime'
        ? resolvedSearchParams.period_type
        : challenge.period_type ?? 'lifetime',
    goalUnit:
      resolvedSearchParams?.goal_unit === 'run_count'
        ? 'run_count'
        : resolvedSearchParams?.goal_unit === 'distance_km'
          ? 'distance_km'
          : challenge.goal_unit ?? 'distance_km',
    goalTarget:
      resolvedSearchParams?.goal_target
      ?? (
        challenge.goal_target != null
          ? String(challenge.goal_target)
          : challenge.goal_unit === 'run_count'
            ? String(challenge.goal_runs ?? '')
            : String(challenge.goal_km ?? '')
      ),
    xpReward: resolvedSearchParams?.xp_reward ?? String(challenge.xp_reward ?? 0),
    startsAt: resolvedSearchParams?.starts_at ?? challenge.starts_at ?? '',
    endAt: resolvedSearchParams?.end_at ?? challenge.end_at ?? '',
    badgeUrl: resolvedSearchParams?.badge_url ?? challenge.badge_url ?? '',
    badgeStoragePath: resolvedSearchParams?.badge_storage_path ?? challenge.badge_storage_path ?? '',
  } as const

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href={`/admin/challenges/${challenge.id}`}
          className="app-text-secondary text-sm transition-opacity hover:opacity-70"
        >
          Назад к челленджу
        </Link>
        <h1 className="app-text-primary text-2xl font-bold">Редактирование челленджа</h1>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ChallengeForm
        mode="edit"
        action={updateChallengeAction}
        cancelHref={`/admin/challenges/${challenge.id}`}
        currentUserId={profile.id}
        initialValues={formValues}
      />
    </div>
  )
}
