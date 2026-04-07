export type ShoeWearUiStatus = 'fresh' | 'warning' | 'critical'

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
  let label = 'Fresh'

  if (usagePercent > 85) {
    status = 'critical'
    label = 'Critical'
  } else if (usagePercent >= 60) {
    status = 'warning'
    label = 'Warning'
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
