export function formatDistanceKm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

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
