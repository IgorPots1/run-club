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
        <Link href={`/admin/challenges/${challenge.id}`} className="text-sm underline">
          Back to challenge
        </Link>
        <h1 className="text-2xl font-semibold">Edit challenge</h1>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form action={updateChallengeAction} className="space-y-4 rounded border p-4">
        <input type="hidden" name="challenge_id" value={challenge.id} />

        <div className="space-y-1">
          <label htmlFor="title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            defaultValue={challenge.title}
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
            defaultValue={challenge.description ?? ''}
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
            defaultValue={challenge.visibility ?? 'public'}
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
            defaultValue={challenge.goal_km ?? ''}
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
            defaultValue={challenge.goal_runs ?? ''}
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
            defaultValue={challenge.xp_reward ?? 0}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="rounded border px-3 py-2 text-sm">
            Save changes
          </button>
          <Link href={`/admin/challenges/${challenge.id}`} className="text-sm underline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
