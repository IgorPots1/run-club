import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createChallengeAction } from '../actions'
import { ChallengeForm } from '../ChallengeForm'

type NewChallengePageProps = {
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
  }>
}

export default async function NewChallengePage({ searchParams }: NewChallengePageProps) {
  const { profile } = await requireAdmin()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const error = resolvedSearchParams?.error?.trim() || ''
  const title = resolvedSearchParams?.title ?? ''
  const description = resolvedSearchParams?.description ?? ''
  const visibility = resolvedSearchParams?.visibility === 'restricted' ? 'restricted' : 'public'
  const periodType = resolvedSearchParams?.period_type === 'challenge'
    || resolvedSearchParams?.period_type === 'weekly'
    || resolvedSearchParams?.period_type === 'monthly'
    ? resolvedSearchParams.period_type
    : 'lifetime'
  const goalUnit = resolvedSearchParams?.goal_unit === 'run_count' ? 'run_count' : 'distance_km'
  const goalTarget = resolvedSearchParams?.goal_target ?? ''
  const xpReward = resolvedSearchParams?.xp_reward ?? '0'
  const startsAt = resolvedSearchParams?.starts_at ?? ''
  const endAt = resolvedSearchParams?.end_at ?? ''
  const badgeUrl = resolvedSearchParams?.badge_url ?? ''
  const badgeStoragePath = resolvedSearchParams?.badge_storage_path ?? ''

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/admin/challenges"
          className="app-text-secondary text-sm transition-opacity hover:opacity-70"
        >
          Назад к челленджам
        </Link>
        <h1 className="app-text-primary text-2xl font-bold">Новый челлендж</h1>
        <p className="app-text-secondary text-sm">Создайте новый челлендж в стиле Run Club.</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ChallengeForm
        mode="create"
        action={createChallengeAction}
        cancelHref="/admin/challenges"
        currentUserId={profile.id}
        initialValues={{
          title,
          description,
          visibility,
          periodType,
          goalUnit,
          goalTarget,
          xpReward,
          startsAt,
          endAt,
          badgeUrl,
          badgeStoragePath,
        }}
      />
    </div>
  )
}
