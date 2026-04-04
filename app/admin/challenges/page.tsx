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

function formatVisibility(value: string | null | undefined) {
  if (value === 'public') return 'Открытый'
  if (value === 'restricted') return 'По доступу'
  return formatNullableValue(value)
}

function formatChallengeStatus(value: string | null | undefined) {
  if (value === 'draft') return 'Черновик'
  if (value === 'active') return 'Активный'
  if (value === 'completed') return 'Завершён'
  if (value === 'archived') return 'В архиве'
  return formatNullableValue(value)
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

  let data: ChallengeRow[] | null = (primaryResult.data as ChallengeRow[] | null) ?? null

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

    data = (fallbackResult.data as ChallengeRow[] | null) ?? null
  }

  const challenges = data ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h1 className="app-text-primary text-2xl font-bold">Челленджи</h1>
          <p className="app-text-secondary text-sm">Создание, редактирование и управление доступом к челленджам.</p>
        </div>
        <Link
          href="/admin/challenges/new"
          className="app-button-primary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm"
        >
          Новый челлендж
        </Link>
      </div>

      {challenges.length === 0 ? (
        <div className="app-card rounded-2xl border p-4 shadow-sm">
          <p className="app-text-secondary text-sm">Челленджей пока нет.</p>
        </div>
      ) : (
        <div className="app-card overflow-x-auto rounded-2xl border shadow-sm">
          <table className="min-w-full border-collapse">
            <thead className="app-surface-muted">
              <tr className="text-left">
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Название</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Видимость</th>
                {hasStatusColumn ? (
                  <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Статус</th>
                ) : null}
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Награда XP</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Цель, км</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Цель, тренировки</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Создан</th>
              </tr>
            </thead>
            <tbody>
              {challenges.map((challenge) => (
                <tr key={challenge.id} className="border-b align-top">
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <Link href={`/admin/challenges/${challenge.id}`} className="app-text-primary font-semibold underline decoration-black/20 underline-offset-4">
                        {challenge.title}
                      </Link>
                      <Link href={`/admin/challenges/${challenge.id}/edit`} className="app-text-secondary text-sm underline decoration-black/20 underline-offset-4">
                        Редактировать
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3">{formatVisibility(challenge.visibility)}</td>
                  {hasStatusColumn ? (
                    <td className="px-4 py-3">{formatChallengeStatus(challenge.status)}</td>
                  ) : null}
                  <td className="px-4 py-3">{formatNullableValue(challenge.xp_reward)}</td>
                  <td className="px-4 py-3">{formatNullableValue(challenge.goal_km)}</td>
                  <td className="px-4 py-3">{formatNullableValue(challenge.goal_runs)}</td>
                  <td className="app-text-secondary px-4 py-3 text-sm">{formatNullableValue(challenge.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
