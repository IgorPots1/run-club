export function formatDistanceKm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

const RUSSIAN_SHORT_MONTH_LABELS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const

function parseRunDate(dateString: string) {
  const runDate = new Date(dateString)

  if (Number.isNaN(runDate.getTime())) {
    return null
  }

  return runDate
}

export function formatRunDateLabel(dateString: string) {
  const runDate = parseRunDate(dateString)

  if (!runDate) {
    return 'Дата неизвестна'
  }

  return runDate.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
}

export function formatRunDateTimeLabel(dateString: string) {
  const runDate = parseRunDate(dateString)

  if (!runDate) {
    return 'Дата неизвестна'
  }

  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  const runDayKey = `${runDate.getFullYear()}-${runDate.getMonth()}-${runDate.getDate()}`
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`
  const timeLabel = runDate.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (runDayKey === todayKey) {
    return `Сегодня ${timeLabel}`
  }

  if (runDayKey === yesterdayKey) {
    return `Вчера ${timeLabel}`
  }

  const dateLabel = runDate.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })

  return `${dateLabel} ${timeLabel}`
}

export function formatRunTimestampLabel(dateString: string, externalSource?: string | null) {
  if (externalSource === 'strava') {
    return formatRunDateTimeLabel(dateString)
  }

  return formatRunDateLabel(dateString)
}

export function formatMonthYearLabel(dateString: string) {
  const date = parseRunDate(dateString)

  if (!date) {
    return 'дата неизвестна'
  }

  return `${RUSSIAN_SHORT_MONTH_LABELS[date.getMonth()] ?? ''} ${date.getFullYear()}`.trim()
}

export function formatDurationCompact(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0 мин'
  }

  const safeSeconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)

  if (hours > 0) {
    return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`
  }

  return `${Math.max(minutes, 1)} мин`
}
