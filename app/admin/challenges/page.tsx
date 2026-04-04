import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type ChallengeRow = {
  id: string
  title: string
  visibility: string | null
  status?: string | null
  xp_reward: number | null
  goal_km: number | null
  goal_runs: number | null
  created_at: string | null
}

function formatNullableValue(value: number | string | null | undefined) {
  return value == null || value === '' ? '—' : String(value)
}

function isMissingChallengeStatusColumnError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    Boolean(error.message?.includes('challenges.status')) ||
    Boolean(error.message?.includes("'status' column of 'challenges'"))
  )
}

export default async function AdminChallengesPage() {
  await requireAdmin()

  const supabase = createSupabaseAdminClient()
  let hasStatusColumn = true
  const primaryResult = await supabase
    .from('challenges')
    .select('id, title, visibility, status, xp_reward, goal_km, goal_runs, created_at')
    .order('created_at', { ascending: false })

  let data = primaryResult.data

  if (primaryResult.error) {
    if (!isMissingChallengeStatusColumnError(primaryResult.error)) {
      throw primaryResult.error
    }

    hasStatusColumn = false
    const fallbackResult = await supabase
      .from('challenges')
      .select('id, title, visibility, xp_reward, goal_km, goal_runs, created_at')
      .order('created_at', { ascending: false })

    if (fallbackResult.error) {
      throw fallbackResult.error
    }

    data = fallbackResult.data
  }

  const challenges = (data as ChallengeRow[] | null) ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Challenges admin</h1>
          <p className="text-sm text-gray-600">Manage challenge definitions.</p>
        </div>
        <Link
          href="/admin/challenges/new"
          className="rounded border px-3 py-2 text-sm"
        >
          New challenge
        </Link>
      </div>

      {challenges.length === 0 ? (
        <p>No challenges yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Visibility</th>
                {hasStatusColumn ? (
                  <th className="px-3 py-2 font-medium">Status</th>
                ) : null}
                <th className="px-3 py-2 font-medium">XP reward</th>
                <th className="px-3 py-2 font-medium">Goal km</th>
                <th className="px-3 py-2 font-medium">Goal runs</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {challenges.map((challenge) => (
                <tr key={challenge.id} className="border-b align-top">
                  <td className="px-3 py-2">{challenge.title}</td>
                  <td className="px-3 py-2">{formatNullableValue(challenge.visibility)}</td>
                  {hasStatusColumn ? (
                    <td className="px-3 py-2">{formatNullableValue(challenge.status)}</td>
                  ) : null}
                  <td className="px-3 py-2">{formatNullableValue(challenge.xp_reward)}</td>
                  <td className="px-3 py-2">{formatNullableValue(challenge.goal_km)}</td>
                  <td className="px-3 py-2">{formatNullableValue(challenge.goal_runs)}</td>
                  <td className="px-3 py-2">{formatNullableValue(challenge.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
