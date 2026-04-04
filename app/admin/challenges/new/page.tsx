import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createChallengeAction } from '../actions'

type NewChallengePageProps = {
  searchParams?: Promise<{
    error?: string
  }>
}

export default async function NewChallengePage({ searchParams }: NewChallengePageProps) {
  await requireAdmin()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const error = resolvedSearchParams?.error?.trim() || ''

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
            defaultValue="public"
            className="w-full rounded border px-3 py-2"
          >
            <option value="public">public</option>
            <option value="restricted">restricted</option>
          </select>
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
            defaultValue="0"
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
