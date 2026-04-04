import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createChallengeAction } from '../actions'

type NewChallengePageProps = {
  searchParams?: Promise<{
    error?: string
    title?: string
    description?: string
    visibility?: string
    goal_km?: string
    goal_runs?: string
    xp_reward?: string
  }>
}

export default async function NewChallengePage({ searchParams }: NewChallengePageProps) {
  await requireAdmin()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const error = resolvedSearchParams?.error?.trim() || ''
  const title = resolvedSearchParams?.title ?? ''
  const description = resolvedSearchParams?.description ?? ''
  const visibility = resolvedSearchParams?.visibility === 'restricted' ? 'restricted' : 'public'
  const goalKm = resolvedSearchParams?.goal_km ?? ''
  const goalRuns = resolvedSearchParams?.goal_runs ?? ''
  const xpReward = resolvedSearchParams?.xp_reward ?? '0'

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

      <form action={createChallengeAction} className="app-card space-y-4 rounded-2xl border p-4 shadow-sm">
        <div className="space-y-1">
          <label htmlFor="title" className="app-text-secondary block text-sm">
            Название
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            defaultValue={title}
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
            defaultValue={description}
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
            defaultValue={visibility}
            className="app-input w-full rounded-2xl border px-3 py-2"
          >
            <option value="public">Открытый</option>
            <option value="restricted">По доступу</option>
          </select>
          {visibility === 'restricted' ? (
            <p className="app-text-secondary text-sm">
              После создания нужно выдать доступ участникам
            </p>
          ) : null}
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
            defaultValue={goalKm}
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
            defaultValue={goalRuns}
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
            defaultValue={xpReward}
            className="app-input w-full rounded-2xl border px-3 py-2"
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="app-button-primary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm">
            Создать челлендж
          </button>
          <Link
            href="/admin/challenges"
            className="app-text-secondary text-sm transition-opacity hover:opacity-70"
          >
            Отмена
          </Link>
        </div>
      </form>
    </div>
  )
}
