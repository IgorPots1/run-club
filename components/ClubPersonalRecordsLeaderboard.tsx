'use client'

import Image from 'next/image'
import Link from 'next/link'
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
      typeof candidate.durationSeconds === 'number' &&
      (candidate.recordDate == null || typeof candidate.recordDate === 'string')
    )
  })
}

export default function ClubPersonalRecordsLeaderboard() {
  const [selectedDistance, setSelectedDistance] = useState<ClubPersonalRecordDistance>(5000)
  const [rows, setRows] = useState<ClubPersonalRecordLeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
    <section className="app-card mb-4 rounded-xl border p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="app-text-primary text-lg font-semibold">Личные рекорды</p>
          <p className="app-text-secondary mt-1 text-sm">Рейтинг клуба по выбранной дистанции</p>
        </div>
      </div>

      <div className="app-surface-muted mt-4 grid grid-cols-2 rounded-xl p-1 sm:grid-cols-4">
        {CLUB_PERSONAL_RECORD_DISTANCES.map((distance) => (
          <button
            key={distance}
            type="button"
            aria-pressed={selectedDistance === distance}
            onClick={() => setSelectedDistance(distance)}
            className={`min-h-11 rounded-lg px-4 py-3 text-sm font-medium ${
              selectedDistance === distance ? 'app-card shadow-sm' : 'app-text-secondary'
            }`}
          >
            {CLUB_PERSONAL_RECORD_DISTANCE_LABELS[distance]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="skeleton-line h-4 w-6" />
                <div className="h-10 w-10 rounded-full bg-[var(--color-card-border)]/50" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton-line h-4 w-28" />
                  <div className="skeleton-line h-3 w-16" />
                </div>
              </div>
              <div className="space-y-2 text-right">
                <div className="skeleton-line h-4 w-16" />
                <div className="skeleton-line h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <p className="app-text-secondary mt-4 text-sm">Пока ни у кого нет результата на этой дистанции.</p>
      ) : (
        <div className="mt-4">
          <div className="app-text-secondary grid grid-cols-[auto,minmax(0,1fr),auto] gap-3 px-3 text-[11px] font-medium uppercase tracking-wide">
            <span>Место</span>
            <span>Участник</span>
            <span className="text-right">Результат</span>
          </div>

          <div className="mt-2 space-y-2">
            {rows.map((row) => (
              <div key={row.userId} className="app-surface-muted rounded-xl px-3 py-3">
                <div className="grid grid-cols-[auto,minmax(0,1fr),auto] gap-3">
                  <div className="app-text-secondary flex min-h-10 items-center text-sm font-medium">
                    {row.rank}
                  </div>

                  <Link href={`/users/${row.userId}`} className="flex min-w-0 items-center gap-3">
                    {row.avatarUrl ? (
                      <Image
                        src={row.avatarUrl}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-medium dark:bg-gray-700 dark:text-gray-100">
                        {(row.displayName[0] ?? '?').toUpperCase()}
                      </span>
                    )}

                    <div className="min-w-0">
                      <p className="app-text-primary truncate font-medium">{row.displayName}</p>
                      <p className="app-text-secondary text-xs">{formatRecordDate(row.recordDate)}</p>
                    </div>
                  </Link>

                  <div className="min-h-10 text-right">
                    <p className="app-text-primary font-semibold">{formatRecordTime(row.durationSeconds)}</p>
                    <p className="app-text-secondary text-xs">PR</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
