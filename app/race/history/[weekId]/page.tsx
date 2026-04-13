import Link from 'next/link'
import { redirect } from 'next/navigation'
import InnerPageHeader from '@/components/InnerPageHeader'
import { formatRacePlacementLabel, formatRaceRankLabel, formatRaceWeekDateRange, getRaceBadgeLabel, getRacePodiumBadgeTone } from '@/lib/race-badges'
import {
  loadFinalizedRaceWeek,
  loadRaceWeekBadgesByUserIds,
  loadLatestFinalizedRaceWeek,
  loadRaceWeekParticipantCount,
  loadRaceWeekTopResults,
  loadRaceWeekUserBadge,
  loadRaceWeekUserResult,
} from '@/lib/race-results'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
    weekId: string
  }>
}

function getTopRowClass(rank: number, isCurrentUser: boolean) {
  if (isCurrentUser) {
    return 'app-card app-surface-muted ring-1 ring-black/10 dark:ring-white/15'
  }

  if (rank > 0 && rank <= 3) {
    return 'app-card bg-black/[0.03] ring-1 ring-black/5 dark:bg-white/[0.05] dark:ring-white/10'
  }

  return 'app-card'
}

function getPodiumBadgeChipClass(badgeCode: string | null | undefined, rank: number | null | undefined) {
  const tone = getRacePodiumBadgeTone(badgeCode, rank)

  if (tone === 'gold') {
    return 'border border-amber-300/80 bg-amber-100/90 text-amber-900 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100'
  }

  if (tone === 'silver') {
    return 'border border-slate-300/80 bg-slate-100/90 text-slate-700 dark:border-slate-300/20 dark:bg-slate-300/10 dark:text-slate-100'
  }

  if (tone === 'bronze') {
    return 'border border-orange-300/80 bg-orange-100/90 text-orange-800 dark:border-orange-300/20 dark:bg-orange-300/10 dark:text-orange-100'
  }

  return 'border border-black/[0.06] bg-black/[0.04] text-black/70 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white/80'
}

export default async function RaceHistoryWeekPage({ params }: PageProps) {
  const [{ user, error }, { weekId }] = await Promise.all([getAuthenticatedUser(), params])

  if (error || !user) {
    redirect('/login')
  }

  const [week, topResults, userResult, badge, totalParticipants] = await Promise.all([
    loadFinalizedRaceWeek(weekId),
    loadRaceWeekTopResults(weekId),
    loadRaceWeekUserResult(weekId, user.id),
    loadRaceWeekUserBadge(weekId, user.id),
    loadRaceWeekParticipantCount(weekId),
  ])

  if (!week) {
    const latestWeek = await loadLatestFinalizedRaceWeek()

    return (
      <main className="min-h-screen">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <InnerPageHeader title="Итоги гонки" fallbackHref="/race" />

          <div className="app-card mt-4 rounded-2xl border p-4 shadow-sm">
            <h1 className="app-text-primary text-2xl font-bold">Итоги недели</h1>
            <p className="app-text-secondary mt-2 text-sm">Завершенная неделя не найдена.</p>
            {latestWeek ? (
              <Link
                href={`/race/history/${latestWeek.id}`}
                className="app-button-secondary mt-4 inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-sm"
              >
                Открыть последнюю завершенную неделю
              </Link>
            ) : (
              <p className="app-text-secondary mt-4 text-sm">Пока нет сохраненных итогов.</p>
            )}
          </div>
        </div>
      </main>
    )
  }

  const placementLabel = formatRacePlacementLabel({
    badgeCode: badge?.badgeCode,
    rank: badge?.sourceRank ?? userResult?.rank ?? null,
    totalParticipants,
  })
  const topResultBadgesByUserId = await loadRaceWeekBadgesByUserIds(
    weekId,
    topResults.map((row) => row.userId)
  )

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <InnerPageHeader title="Итоги гонки" fallbackHref="/race" />

        <div className="app-card mt-4 rounded-2xl border p-4 shadow-sm">
          <h1 className="app-text-primary text-2xl font-bold">Итоги недели</h1>
          <p className="app-text-secondary mt-1 text-sm">{formatRaceWeekDateRange(week)}</p>

          {userResult ? (
            <div className="app-surface-muted mt-4 rounded-2xl p-4">
              <p className="app-text-primary text-sm font-semibold">Твой результат</p>
              {placementLabel ? (
                <p className="app-text-secondary mt-1 text-sm">{placementLabel}</p>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="app-text-secondary text-xs uppercase tracking-wide">Место</p>
                  <p className="app-text-primary mt-1 text-lg font-semibold">{formatRaceRankLabel(userResult.rank)}</p>
                </div>
                <div>
                  <p className="app-text-secondary text-xs uppercase tracking-wide">XP</p>
                  <p className="app-text-primary mt-1 text-lg font-semibold">{userResult.totalXp}</p>
                </div>
              </div>
              {userResult.raceBonusXp > 0 ? (
                <p className="app-text-secondary mt-3 text-sm">{`Бонус недели +${userResult.raceBonusXp} XP`}</p>
              ) : null}
            </div>
          ) : (
            <div className="app-surface-muted mt-4 rounded-2xl p-4">
              <p className="app-text-primary text-sm font-medium">Ты не участвовал в этой неделе</p>
            </div>
          )}

          <div className="mt-5">
            <h2 className="app-text-primary text-base font-semibold">Топ-10</h2>
            {topResults.length === 0 ? (
              <p className="app-text-secondary mt-3 text-sm">Нет финальных результатов за эту неделю.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {topResults.map((row) => {
                  const isCurrentUser = row.userId === user.id
                  const rowBadge = topResultBadgesByUserId.get(row.userId) ?? null
                  const rowBadgeTitle = rowBadge ? getRaceBadgeLabel(rowBadge.badgeCode, row.rank) : ''

                  return (
                    <div
                      key={row.id}
                      className={`rounded-2xl border p-4 shadow-sm ${getTopRowClass(row.rank, isCurrentUser)}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p
                              className={`app-text-primary truncate text-sm ${
                                isCurrentUser || row.rank <= 3 ? 'font-semibold' : 'font-medium'
                              }`}
                            >
                              {row.rank}. {row.displayName}
                            </p>
                            {rowBadge ? (
                              <span className="inline-flex shrink-0 items-center whitespace-nowrap">
                                <span
                                  title={rowBadgeTitle}
                                  aria-label={rowBadgeTitle}
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getPodiumBadgeChipClass(
                                    rowBadge.badgeCode,
                                    row.rank
                                  )}`}
                                >
                                  {rowBadgeTitle}
                                </span>
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <p
                          className={`app-text-primary shrink-0 text-sm ${
                            isCurrentUser || row.rank <= 3 ? 'font-semibold' : 'font-medium'
                          }`}
                        >
                          {row.totalXp} XP
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
