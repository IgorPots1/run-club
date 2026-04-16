import Link from 'next/link'
import { redirect } from 'next/navigation'
import InnerPageHeader from '@/components/InnerPageHeader'
import { loadCurrentUserPersonalRecords, type PersonalRecordView } from '@/lib/personal-records'
import { getAuthenticatedUser } from '@/lib/supabase-server'

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

function formatRecordPace(paceSecondsPerKm: number | null) {
  if (!Number.isFinite(paceSecondsPerKm) || (paceSecondsPerKm ?? 0) <= 0) {
    return '—'
  }

  const safePace = Math.max(1, Math.round(paceSecondsPerKm ?? 0))
  const minutes = Math.floor(safePace / 60)
  const seconds = safePace % 60
  return `${minutes}:${String(seconds).padStart(2, '0')} /км`
}

function formatRecordDate(recordDate: string | null) {
  if (!recordDate) {
    return 'Дата неизвестна'
  }

  const parsedDate = new Date(`${recordDate}T12:00:00Z`)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Дата неизвестна'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsedDate)
}

function PersonalRecordCard({
  distanceLabel,
  record,
}: {
  distanceLabel: string
  record: PersonalRecordView | null
}) {
  return (
    <section className="app-card rounded-2xl border p-4 shadow-sm md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="app-text-secondary text-xs font-medium uppercase tracking-wide">{distanceLabel}</p>
          <p className="app-text-primary mt-2 text-2xl font-semibold">
            {record ? formatRecordTime(record.duration_seconds) : 'Пока нет'}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="app-text-secondary text-xs font-medium uppercase tracking-wide">Темп</p>
          <p className="app-text-primary mt-2 text-sm font-medium">
            {record ? formatRecordPace(record.pace_seconds_per_km) : '—'}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          <span className="app-text-secondary">Дата</span>
          <span className="app-text-primary text-right">{record ? formatRecordDate(record.record_date) : '—'}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="app-text-secondary">Тренировка</span>
          {record ? (
            record.run_id ? (
              <Link href={`/runs/${record.run_id}`} className="text-right text-sm font-medium text-blue-600">
                Открыть тренировку
              </Link>
            ) : (
              <span className="app-text-primary text-right">Исторический результат Strava</span>
            )
          ) : (
            <span className="app-text-primary text-right">—</span>
          )}
        </div>
      </div>
    </section>
  )
}

export default async function ActivityRecordsPage() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  let records: PersonalRecordView[] = []
  let loadFailed = false

  try {
    records = await loadCurrentUserPersonalRecords()
  } catch {
    loadFailed = true
  }

  const recordsByDistance = new Map(records.map((record) => [record.distance_meters, record]))
  const hasAnyRecords = records.length > 0

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <InnerPageHeader title="Рекорды" fallbackHref="/activity" />

        <div className="app-surface-muted mt-4 grid grid-cols-2 rounded-xl p-1">
          <Link
            href="/races"
            className="app-text-secondary flex min-h-11 items-center justify-center rounded-lg px-4 py-3 text-sm font-medium"
          >
            Старты
          </Link>
          <div className="app-card flex min-h-11 items-center justify-center rounded-lg px-4 py-3 text-sm font-medium shadow-sm">
            Рекорды
          </div>
        </div>

        <div className="mt-4">
          {loadFailed ? (
            <div className="app-card rounded-2xl border p-4 shadow-sm">
              <p className="text-sm text-red-600">Не удалось загрузить рекорды</p>
            </div>
          ) : !hasAnyRecords ? (
            <div className="app-card rounded-2xl border p-5 text-center shadow-sm md:p-6">
              <p className="app-text-secondary text-sm">Личные рекорды пока не найдены.</p>
              <p className="app-text-secondary mt-2 text-sm">
                Рекорды появятся после подходящего полного забега на 5 км или 10 км и после синка Strava.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <PersonalRecordCard distanceLabel="5 км" record={recordsByDistance.get(5000) ?? null} />
              <PersonalRecordCard distanceLabel="10 км" record={recordsByDistance.get(10000) ?? null} />
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
