import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { updateChallengeAction } from '../../actions'

type EditChallengePageProps = {
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
  description: string | null
  visibility: string | null
  goal_km: number | null
  goal_runs: number | null
  xp_reward: number | null
}

export default async function EditChallengePage({
  params,
  searchParams,
}: EditChallengePageProps) {
  await requireAdmin()

  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ? searchParams : Promise.resolve(undefined),
  ])
  const error = resolvedSearchParams?.error?.trim() || ''
  const supabase = createSupabaseAdminClient()
  const { data, error: challengeError } = await supabase
    .from('challenges')
    .select('id, title, description, visibility, goal_km, goal_runs, xp_reward')
    .eq('id', id)
    .maybeSingle()

  if (challengeError) {
    throw challengeError
  }

  const challenge = (data as ChallengeRow | null) ?? null

  if (!challenge) {
    notFound()
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href={`/admin/challenges/${challenge.id}`}
          className="app-text-secondary text-sm underline decoration-black/20 underline-offset-4"
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

      <form action={updateChallengeAction} className="app-card space-y-4 rounded-2xl border p-4 shadow-sm">
        <input type="hidden" name="challenge_id" value={challenge.id} />

        <div className="space-y-1">
          <label htmlFor="title" className="app-text-secondary block text-sm">
            Название
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            defaultValue={challenge.title}
            className="app-input w-full rounded-2xl border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="description" className="app-text-secondary block text-sm">
            Описание
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={challenge.description ?? ''}
            className="app-input w-full rounded-2xl border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="visibility" className="app-text-secondary block text-sm">
            Видимость
          </label>
          <select
            id="visibility"
            name="visibility"
            defaultValue={challenge.visibility ?? 'public'}
            className="app-input w-full rounded-2xl border px-3 py-2"
          >
            <option value="public">Открытый</option>
            <option value="restricted">По доступу</option>
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="goal_km" className="app-text-secondary block text-sm">
            Цель по километрам
          </label>
          <input
            id="goal_km"
            name="goal_km"
            type="number"
            min="0"
            step="0.01"
            defaultValue={challenge.goal_km ?? ''}
            className="app-input w-full rounded-2xl border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="goal_runs" className="app-text-secondary block text-sm">
            Цель по тренировкам
          </label>
          <input
            id="goal_runs"
            name="goal_runs"
            type="number"
            min="0"
            step="1"
            defaultValue={challenge.goal_runs ?? ''}
            className="app-input w-full rounded-2xl border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="xp_reward" className="app-text-secondary block text-sm">
            Награда XP
          </label>
          <input
            id="xp_reward"
            name="xp_reward"
            type="number"
            min="0"
            step="1"
            defaultValue={challenge.xp_reward ?? 0}
            className="app-input w-full rounded-2xl border px-3 py-2"
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="app-button-primary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm">
            Сохранить
          </button>
          <Link
            href={`/admin/challenges/${challenge.id}`}
            className="app-text-secondary text-sm underline decoration-black/20 underline-offset-4"
          >
            Отмена
          </Link>
        </div>
      </form>
    </div>
  )
}
