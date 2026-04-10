import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createChallengeAction } from '../actions'
import { ChallengeForm, type ChallengeFormTemplateOption } from '../ChallengeForm'

type ChallengePeriodType = 'lifetime' | 'challenge' | 'weekly' | 'monthly'
type ChallengeGoalUnit = 'distance_km' | 'run_count'

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
    template_id?: string
  }>
}

export default async function NewChallengePage({ searchParams }: NewChallengePageProps) {
  const { profile } = await requireAdmin()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const supabase = createSupabaseAdminClient()
  const templateId = resolvedSearchParams?.template_id?.trim() ?? ''
  const error = resolvedSearchParams?.error?.trim() || ''
  const { data: templateRows, error: templatesError } = await supabase
    .from('challenge_templates')
    .select('id, title, description, period_type, goal_unit, goal_target, xp_reward, starts_at, end_at, badge_url')
    .order('created_at', { ascending: false })

  if (templatesError) {
    throw templatesError
  }

  const templates: ChallengeFormTemplateOption[] = (templateRows ?? []).flatMap((template) => {
    if (!template || typeof template.id !== 'string' || typeof template.title !== 'string') {
      return []
    }

    const periodType: ChallengePeriodType = template.period_type === 'challenge'
      || template.period_type === 'weekly'
      || template.period_type === 'monthly'
      || template.period_type === 'lifetime'
      ? template.period_type
      : 'lifetime'
    const goalUnit: ChallengeGoalUnit = template.goal_unit === 'run_count' ? 'run_count' : 'distance_km'

    return [{
      id: template.id,
      title: template.title,
      description: template.description ?? '',
      periodType,
      goalUnit,
      goalTarget: String(template.goal_target ?? ''),
      xpReward: String(template.xp_reward ?? 0),
      startsAt: template.starts_at ?? '',
      endAt: template.end_at ?? '',
      badgeUrl: template.badge_url ?? '',
    }]
  })
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null
  const title = resolvedSearchParams?.title ?? selectedTemplate?.title ?? ''
  const description = resolvedSearchParams?.description ?? selectedTemplate?.description ?? ''
  const visibility = resolvedSearchParams?.visibility === 'restricted' ? 'restricted' : 'public'
  const periodType: ChallengePeriodType = resolvedSearchParams?.period_type === 'challenge'
    || resolvedSearchParams?.period_type === 'weekly'
    || resolvedSearchParams?.period_type === 'monthly'
    || resolvedSearchParams?.period_type === 'lifetime'
    ? resolvedSearchParams.period_type
    : selectedTemplate?.periodType ?? 'lifetime'
  const goalUnit: ChallengeGoalUnit = resolvedSearchParams?.goal_unit === 'run_count'
    ? 'run_count'
    : resolvedSearchParams?.goal_unit === 'distance_km'
      ? 'distance_km'
      : selectedTemplate?.goalUnit ?? 'distance_km'
  const goalTarget = resolvedSearchParams?.goal_target ?? selectedTemplate?.goalTarget ?? ''
  const xpReward = resolvedSearchParams?.xp_reward ?? selectedTemplate?.xpReward ?? '0'
  const startsAt = resolvedSearchParams?.starts_at ?? selectedTemplate?.startsAt ?? ''
  const endAt = resolvedSearchParams?.end_at ?? selectedTemplate?.endAt ?? ''
  const badgeUrl = resolvedSearchParams?.badge_url ?? selectedTemplate?.badgeUrl ?? ''
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
        availableTemplates={templates}
        initialValues={{
          recordId: undefined,
          templateId,
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
