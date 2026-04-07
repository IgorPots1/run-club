export const SHOE_WEAR_WARNING_THRESHOLD_PERCENT = 60
export const SHOE_WEAR_CRITICAL_THRESHOLD_PERCENT = 85

export type ShoeWearUiStatus = 'fresh' | 'warning' | 'critical'
export type ShoeWearUiLabel = 'В ресурсе' | 'На исходе' | 'Пора менять'

type ShoeWearUiInput = {
  currentDistanceMeters: number
  maxDistanceMeters: number
}

export function formatShoeDistanceMetersAsKm(value: number) {
  const kmValue = Math.max(0, value) / 1000
  return kmValue.toFixed(2).replace(/\.?0+$/, '')
}

export function getShoeWearUi(input: ShoeWearUiInput) {
  const safeCurrentDistanceMeters = Math.max(0, Math.round(Number(input.currentDistanceMeters) || 0))
  const safeMaxDistanceMeters = Math.max(1, Math.round(Number(input.maxDistanceMeters) || 0))
  const usagePercent = (safeCurrentDistanceMeters / safeMaxDistanceMeters) * 100

  let status: ShoeWearUiStatus = 'fresh'
  let label: ShoeWearUiLabel = 'В ресурсе'

  if (usagePercent > SHOE_WEAR_CRITICAL_THRESHOLD_PERCENT) {
    status = 'critical'
    label = 'Пора менять'
  } else if (usagePercent >= SHOE_WEAR_WARNING_THRESHOLD_PERCENT) {
    status = 'warning'
    label = 'На исходе'
  }

  return {
    currentDistanceMeters: safeCurrentDistanceMeters,
    maxDistanceMeters: safeMaxDistanceMeters,
    usagePercent,
    status,
    label,
    distanceLabel: `${formatShoeDistanceMetersAsKm(safeCurrentDistanceMeters)} / ${formatShoeDistanceMetersAsKm(safeMaxDistanceMeters)} км`,
  }
}
