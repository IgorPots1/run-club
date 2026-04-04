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
        <h1 className="text-2xl font-semibold">New challenge</h1>
        <p className="text-sm text-gray-600">Create a new challenge definition.</p>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form action={createChallengeAction} className="space-y-4 rounded border p-4">
        <div className="space-y-1">
          <label htmlFor="title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            defaultValue={title}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="description" className="block text-sm font-medium">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={description}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="visibility" className="block text-sm font-medium">
            Visibility
          </label>
          <select
            id="visibility"
            name="visibility"
            defaultValue={visibility}
            className="w-full rounded border px-3 py-2"
          >
            <option value="public">public</option>
            <option value="restricted">restricted</option>
          </select>
          {visibility === 'restricted' ? (
            <p className="text-sm text-gray-600">
              После создания нужно выдать доступ участникам
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <label htmlFor="goal_km" className="block text-sm font-medium">
            Goal km
          </label>
          <input
            id="goal_km"
            name="goal_km"
            type="number"
            min="0"
            step="0.01"
            defaultValue={goalKm}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="goal_runs" className="block text-sm font-medium">
            Goal runs
          </label>
          <input
            id="goal_runs"
            name="goal_runs"
            type="number"
            min="0"
            step="1"
            defaultValue={goalRuns}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="xp_reward" className="block text-sm font-medium">
            XP reward
          </label>
          <input
            id="xp_reward"
            name="xp_reward"
            type="number"
            min="0"
            step="1"
            defaultValue={xpReward}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="rounded border px-3 py-2 text-sm">
            Create challenge
          </button>
          <Link href="/admin/challenges" className="text-sm underline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
