export function formatDistanceKm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function formatRunDateTimeLabel(dateString: string) {
  const runDate = new Date(dateString)

  if (Number.isNaN(runDate.getTime())) {
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
