import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createChallengeTemplateAction } from '../../challenges/actions'
import { ChallengeForm } from '../../challenges/ChallengeForm'

type NewChallengeTemplatePageProps = {
  searchParams?: Promise<{
    error?: string
    title?: string
    description?: string
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

export default async function NewChallengeTemplatePage({ searchParams }: NewChallengeTemplatePageProps) {
  const { profile } = await requireAdmin()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const error = resolvedSearchParams?.error?.trim() || ''
  const title = resolvedSearchParams?.title ?? ''
  const description = resolvedSearchParams?.description ?? ''
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
          href="/admin/challenge-templates"
          className="app-text-secondary text-sm transition-opacity hover:opacity-70"
        >
          Назад к шаблонам
        </Link>
        <h1 className="app-text-primary text-2xl font-bold">Новый шаблон челленджа</h1>
        <p className="app-text-secondary text-sm">Создайте шаблон, чтобы переиспользовать его при создании новых челленджей.</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ChallengeForm
        entityType="template"
        mode="create"
        action={createChallengeTemplateAction}
        cancelHref="/admin/challenge-templates"
        currentUserId={profile.id}
        initialValues={{
          title,
          description,
          visibility: 'public',
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
