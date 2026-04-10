import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { updateChallengeTemplateAction } from '../../../challenges/actions'
import { ChallengeForm } from '../../../challenges/ChallengeForm'

type EditChallengeTemplatePageProps = {
  params: Promise<{
    id: string
  }>
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

type ChallengeTemplateRow = {
  id: string
  title: string
  description: string | null
  period_type: 'lifetime' | 'challenge' | 'weekly' | 'monthly' | null
  goal_unit: 'distance_km' | 'run_count' | null
  goal_target: number | null
  starts_at: string | null
  end_at: string | null
  badge_url: string | null
  xp_reward: number | null
}

export default async function EditChallengeTemplatePage({
  params,
  searchParams,
}: EditChallengeTemplatePageProps) {
  const { profile } = await requireAdmin()

  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ? searchParams : Promise.resolve(undefined),
  ])
  const error = resolvedSearchParams?.error?.trim() || ''
  const supabase = createSupabaseAdminClient()
  const { data, error: templateError } = await supabase
    .from('challenge_templates')
    .select('id, title, description, period_type, goal_unit, goal_target, starts_at, end_at, badge_url, xp_reward')
    .eq('id', id)
    .maybeSingle()

  if (templateError) {
    throw templateError
  }

  const template = (data as ChallengeTemplateRow | null) ?? null

  if (!template) {
    notFound()
  }

  const formValues = {
    recordId: template.id,
    title: resolvedSearchParams?.title ?? template.title,
    description: resolvedSearchParams?.description ?? template.description ?? '',
    visibility: 'public' as const,
    periodType:
      resolvedSearchParams?.period_type === 'challenge' ||
      resolvedSearchParams?.period_type === 'weekly' ||
      resolvedSearchParams?.period_type === 'monthly' ||
      resolvedSearchParams?.period_type === 'lifetime'
        ? resolvedSearchParams.period_type
        : template.period_type ?? 'lifetime',
    goalUnit:
      resolvedSearchParams?.goal_unit === 'run_count'
        ? 'run_count'
        : resolvedSearchParams?.goal_unit === 'distance_km'
          ? 'distance_km'
          : template.goal_unit ?? 'distance_km',
    goalTarget: resolvedSearchParams?.goal_target ?? String(template.goal_target ?? ''),
    xpReward: resolvedSearchParams?.xp_reward ?? String(template.xp_reward ?? 0),
    startsAt: resolvedSearchParams?.starts_at ?? template.starts_at ?? '',
    endAt: resolvedSearchParams?.end_at ?? template.end_at ?? '',
    badgeUrl: resolvedSearchParams?.badge_url ?? template.badge_url ?? '',
    badgeStoragePath: resolvedSearchParams?.badge_storage_path ?? '',
  } as const

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/admin/challenge-templates"
          className="app-text-secondary text-sm transition-opacity hover:opacity-70"
        >
          Назад к шаблонам
        </Link>
        <h1 className="app-text-primary text-2xl font-bold">Редактирование шаблона</h1>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ChallengeForm
        entityType="template"
        mode="edit"
        action={updateChallengeTemplateAction}
        cancelHref="/admin/challenge-templates"
        currentUserId={profile.id}
        initialValues={formValues}
      />
    </div>
  )
}
