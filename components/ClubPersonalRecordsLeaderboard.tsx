'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  CLUB_PERSONAL_RECORD_DISTANCE_LABELS,
  CLUB_PERSONAL_RECORD_DISTANCES,
  type ClubPersonalRecordDistance,
  type ClubPersonalRecordLeaderboardResponse,
  type ClubPersonalRecordLeaderboardRow,
} from '@/lib/club-personal-records'

function formatRecordTime(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return '—'
  }

  const safeSeconds = Math.max(0, Math.round(durationSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatRecordDate(value: string | null) {
  if (!value) {
    return 'Дата неизвестна'
  }

  const parsedDate = new Date(`${value}T12:00:00Z`)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Дата неизвестна'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsedDate)
}

function getRankLabel(rank: number) {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'

  return `#${rank}`
}

function isLeaderboardResponse(value: unknown): value is ClubPersonalRecordLeaderboardResponse {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { rows?: unknown }).rows)) {
    return false
  }

  return ((value as { rows: unknown[] }).rows).every((row) => {
    if (!row || typeof row !== 'object') {
      return false
    }

    const candidate = row as Partial<ClubPersonalRecordLeaderboardRow>

    return (
      typeof candidate.rank === 'number' &&
      typeof candidate.userId === 'string' &&
      typeof candidate.displayName === 'string' &&
      (candidate.avatarUrl == null || typeof candidate.avatarUrl === 'string') &&
      (candidate.runId == null || typeof candidate.runId === 'string') &&
      typeof candidate.durationSeconds === 'number' &&
      (candidate.recordDate == null || typeof candidate.recordDate === 'string')
    )
  })
}

export default function ClubPersonalRecordsLeaderboard() {
  const router = useRouter()
  const [selectedDistance, setSelectedDistance] = useState<ClubPersonalRecordDistance>(5000)
  const [rows, setRows] = useState<ClubPersonalRecordLeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const segmentBaseClass = 'flex h-10 items-center justify-center rounded-xl px-3 text-sm font-medium transition-colors'

  useEffect(() => {
    const abortController = new AbortController()

    async function loadLeaderboard() {
      setLoading(true)
      setError('')

      try {
        const response = await fetch(`/api/club/personal-records?distance=${selectedDistance}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: abortController.signal,
        })
        const payload = await response.json().catch(() => null) as unknown

        if (!response.ok || !isLeaderboardResponse(payload)) {
          throw new Error('invalid_personal_record_leaderboard_payload')
        }

        setRows(payload.rows)
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return
        }

        console.error('[club] failed to load personal record leaderboard', loadError)
        setRows([])
        setError('Не удалось загрузить рейтинг личных рекордов')
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadLeaderboard()

    return () => {
      abortController.abort()
    }
  }, [selectedDistance])

  return (
    <section className="app-card mb-3 rounded-2xl border p-3.5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="app-text-primary text-base font-semibold sm:text-lg">Личные рекорды</p>
          <p className="app-text-secondary mt-1 text-sm">По выбранной дистанции</p>
        </div>
      </div>

      <div className="app-surface-muted mt-3 grid grid-cols-2 rounded-2xl p-1 sm:grid-cols-4">
        {CLUB_PERSONAL_RECORD_DISTANCES.map((distance) => (
          <button
            key={distance}
            type="button"
            aria-pressed={selectedDistance === distance}
            onClick={() => setSelectedDistance(distance)}
            className={`${segmentBaseClass} ${
              selectedDistance === distance
                ? 'app-card app-text-primary shadow-sm'
                : 'app-text-secondary'
            }`}
          >
            {CLUB_PERSONAL_RECORD_DISTANCE_LABELS[distance]}
          </button>
        ))}
      </div>

      {/* Gender segmented filter intentionally skipped: no reliable gender/sex field in the current profiles payload. */}

      {loading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="app-surface-muted rounded-xl border border-[var(--color-card-border)]/60 px-3 py-2">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-full bg-[var(--color-card-border)]/50" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="skeleton-line h-4 w-28" />
                    <div className="skeleton-line h-4 w-14" />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="skeleton-line h-3 w-24" />
                    <div className="skeleton-line h-4 w-9" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <p className="app-text-secondary mt-3 text-sm">Пока ни у кого нет результата на этой дистанции.</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {rows.map((row) => {
            const runHref = row.runId ? `/runs/${row.runId}` : null
            const rankLabel = getRankLabel(row.rank)

            return (
              <div
                key={row.userId}
                role={runHref ? 'link' : undefined}
                tabIndex={runHref ? 0 : undefined}
                onClick={runHref ? () => router.push(runHref) : undefined}
                onKeyDown={runHref ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    router.push(runHref)
                  }
                } : undefined}
                className={`app-surface-muted rounded-xl border border-[var(--color-card-border)]/60 px-3 py-2 ${
                  runHref ? 'cursor-pointer transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 dark:focus-visible:ring-white/15' : ''
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Link
                    href={`/users/${row.userId}`}
                    onClick={(event) => event.stopPropagation()}
                    className="flex min-w-0 items-center gap-2.5"
                  >
                    {row.avatarUrl ? (
                      <Image
                        src={row.avatarUrl}
                        alt=""
                        width={32}
                        height={32}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium dark:bg-gray-700 dark:text-gray-100">
                        {(row.displayName[0] ?? '?').toUpperCase()}
                      </span>
                    )}

                    <span className="sr-only">Открыть профиль {row.displayName}</span>
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/users/${row.userId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="app-text-primary min-w-0 truncate text-sm font-semibold"
                      >
                        <span className="app-text-secondary mr-1.5 inline-flex min-w-7 items-center justify-start text-sm font-semibold">
                          {rankLabel}
                        </span>
                        <span className="truncate">{row.displayName}</span>
                      </Link>

                      {runHref ? (
                        <Link
                          href={runHref}
                          onClick={(event) => event.stopPropagation()}
                          className="app-text-primary shrink-0 text-[15px] font-semibold leading-tight tabular-nums"
                        >
                          {formatRecordTime(row.durationSeconds)}
                        </Link>
                      ) : (
                        <p className="app-text-primary shrink-0 text-[15px] font-semibold leading-tight tabular-nums">
                          {formatRecordTime(row.durationSeconds)}
                        </p>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-center justify-between gap-3">
                      <p className="app-text-secondary min-w-0 truncate text-[11px]">{formatRecordDate(row.recordDate)}</p>
                      <span className="app-text-secondary inline-flex shrink-0 rounded-md border border-[var(--color-card-border)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">
                        PR
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
