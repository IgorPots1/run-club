'use client'

import { Activity, Trophy } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import {
  getClubLevelDefinitions,
  getLevelProgressFromXP,
  getRankTitleFromLevel,
} from '@/lib/xp'

type LevelOverviewSheetProps = {
  open: boolean
  totalXp: number
  onClose: () => void
}

export default function LevelOverviewSheet({
  open,
  totalXp,
  onClose,
}: LevelOverviewSheetProps) {
  const levelProgress = useMemo(() => getLevelProgressFromXP(totalXp), [totalXp])
  const currentRankTitle = useMemo(
    () => getRankTitleFromLevel(levelProgress.level),
    [levelProgress.level]
  )
  const levels = useMemo(() => getClubLevelDefinitions(), [])

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center md:p-4">
      <button
        type="button"
        aria-label="Закрыть обзор уровней"
        className="absolute inset-0"
        onClick={onClose}
      />
      <section className="app-card relative flex max-h-[min(82vh,48rem)] w-full flex-col rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-lg md:rounded-3xl md:pb-4">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="app-text-primary text-base font-semibold">Уровни клуба</h2>
            <p className="app-text-secondary mt-1 text-sm">
              XP отражает твою стабильность, активность и вклад в жизнь клуба.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="app-text-secondary min-h-11 shrink-0 rounded-xl px-3 py-2 text-sm font-medium"
          >
            Закрыть
          </button>
        </div>

        <div className="mt-4 space-y-3 overflow-y-auto pr-1">
          <div className="rounded-3xl border border-black/5 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="app-text-secondary text-xs font-medium uppercase tracking-wide">Текущий статус</p>
                <p className="app-text-primary mt-2 text-2xl font-semibold">Уровень {levelProgress.level}</p>
                <p className="app-text-secondary mt-1 text-sm">{currentRankTitle}</p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-black/5 bg-white/70 dark:border-white/10 dark:bg-white/5">
                <Trophy className="h-5 w-5" strokeWidth={1.9} />
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-black/5 px-3 py-3 dark:border-white/10">
                <p className="app-text-secondary text-xs">Всего XP</p>
                <p className="app-text-primary mt-1 text-lg font-semibold">{Math.max(0, Math.round(totalXp))}</p>
              </div>
              <div className="rounded-2xl border border-black/5 px-3 py-3 dark:border-white/10">
                <p className="app-text-secondary text-xs">До следующего</p>
                <p className="app-text-primary mt-1 text-lg font-semibold">
                  {levelProgress.nextLevelXP === null ? 'Максимум' : `${levelProgress.xpToNextLevel} XP`}
                </p>
              </div>
            </div>

            <div className="app-progress-track mt-4 h-2 w-full overflow-hidden rounded-full">
              <div
                className="app-accent-bg h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${levelProgress.progressPercent}%` }}
              />
            </div>
            <p className="app-text-secondary mt-2 text-sm">
              {levelProgress.nextLevelXP === null
                ? 'Ты уже на максимальном уровне клуба.'
                : `До уровня ${levelProgress.level + 1}: ${levelProgress.xpToNextLevel} XP`}
            </p>
          </div>

          <div className="rounded-3xl border border-black/5 p-4 dark:border-white/10">
            <div className="flex items-start gap-2">
              <Activity className="app-text-secondary mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
              <p className="app-text-secondary text-sm leading-6">
                XP складывается из тренировок, дистанции, регулярности, челленджей, реакций клуба и недельных бонусов.
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-black/5 p-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-3 px-1 pb-3 pt-1">
              <div>
                <h3 className="app-text-primary text-sm font-semibold">Шкала уровней</h3>
                <p className="app-text-secondary mt-1 text-sm">Минимальный XP для каждого уровня</p>
              </div>
            </div>
            <div className="space-y-2">
              {levels.map((entry) => {
                const isCurrentLevel = entry.level === levelProgress.level
                const isNextLevel = levelProgress.nextLevelXP !== null && entry.level === levelProgress.level + 1

                return (
                  <div
                    key={entry.level}
                    className={`rounded-2xl border px-4 py-3 transition-colors ${
                      isCurrentLevel
                        ? 'border-black/15 bg-black/[0.04] dark:border-white/20 dark:bg-white/[0.08]'
                        : isNextLevel
                          ? 'border-black/10 bg-black/[0.025] dark:border-white/15 dark:bg-white/[0.05]'
                          : 'border-black/5 dark:border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="app-text-primary text-sm font-semibold">
                          Уровень {entry.level}
                          {isCurrentLevel ? ' · сейчас' : isNextLevel ? ' · следующий' : ''}
                        </p>
                        <p className="app-text-secondary mt-1 text-sm">{entry.title}</p>
                      </div>
                      <p className="app-text-primary shrink-0 text-sm font-semibold">{entry.minXp} XP</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
