import { formatDistanceKm } from './format'
import type { DashboardActiveChallenge } from './dashboard-overview'

export const RECENT_AFFECTED_CHALLENGES_STORAGE_KEY = 'recent-affected-challenge-ids'
const RECENT_AFFECTED_CHALLENGES_MAX_AGE_MS = 30 * 60 * 1000

export type PostRunChallengeFeedbackItem = {
  challengeId: string
  title: string
  todayProgressLabel: string
  nearCompletionMessage: string | null
}

type RunContributionInput = {
  distanceKm: number
  createdAt: string
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function isRunWithinChallengeWindow(challenge: DashboardActiveChallenge, runCreatedAt: string) {
  if (challenge.period_type === 'lifetime') {
    return true
  }

  const runTimestamp = toTimestamp(runCreatedAt)
  const periodStartTimestamp = toTimestamp(challenge.period_start)
  const periodEndTimestamp = toTimestamp(challenge.period_end)

  if (runTimestamp === null) {
    return false
  }

  if (periodStartTimestamp !== null && runTimestamp < periodStartTimestamp) {
    return false
  }

  if (periodEndTimestamp !== null && runTimestamp >= periodEndTimestamp) {
    return false
  }

  return true
}

export function getChallengeRunContribution(challenge: DashboardActiveChallenge, run: RunContributionInput) {
  if (!isRunWithinChallengeWindow(challenge, run.createdAt)) {
    return 0
  }

  if (challenge.goal_unit === 'run_count') {
    return 1
  }

  return Math.max(0, run.distanceKm)
}

export function buildNearCompletionChallengeMessage(challenge: DashboardActiveChallenge) {
  if (challenge.isCompleted) {
    return null
  }

  const remaining = Math.max(challenge.goal_target - challenge.progress_value, 0)

  if (remaining <= 0) {
    return null
  }

  if (challenge.goal_unit === 'run_count' && Math.ceil(remaining) === 1) {
    return '💥 Ещё 1 тренировка — и ты закроешь челлендж'
  }

  if (challenge.goal_unit === 'distance_km' && (remaining <= 2 || remaining <= challenge.goal_target * 0.15)) {
    return `🔥 Осталось всего ${formatDistanceKm(remaining)} км`
  }

  return null
}

function formatTodayProgressLabel(challenge: DashboardActiveChallenge, contribution: number) {
  if (challenge.goal_unit === 'run_count') {
    return 'Сегодня: +1 тренировка'
  }

  return `Сегодня: +${formatDistanceKm(contribution)} км`
}

export function buildPostRunChallengeFeedbackItems(
  challenges: DashboardActiveChallenge[],
  run: RunContributionInput,
  limit = 2
) {
  return challenges
    .map((challenge) => {
      const contribution = getChallengeRunContribution(challenge, run)

      if (contribution <= 0) {
        return null
      }

      return {
        challengeId: challenge.id,
        title: challenge.title,
        todayProgressLabel: formatTodayProgressLabel(challenge, contribution),
        nearCompletionMessage: buildNearCompletionChallengeMessage(challenge),
      } satisfies PostRunChallengeFeedbackItem
    })
    .filter((item): item is PostRunChallengeFeedbackItem => item !== null)
    .sort((left, right) => {
      const leftHasNearCompletion = left.nearCompletionMessage ? 1 : 0
      const rightHasNearCompletion = right.nearCompletionMessage ? 1 : 0

      return rightHasNearCompletion - leftHasNearCompletion
    })
    .slice(0, limit)
}

export function getAffectedChallengeIdsForRun(
  challenges: DashboardActiveChallenge[],
  run: RunContributionInput
) {
  const seenIds = new Set<string>()

  return challenges.flatMap((challenge) => {
    if (getChallengeRunContribution(challenge, run) <= 0 || seenIds.has(challenge.id)) {
      return []
    }

    seenIds.add(challenge.id)
    return [challenge.id]
  })
}

export function prioritizeChallengesByIds(
  challenges: DashboardActiveChallenge[],
  prioritizedIds: string[]
) {
  if (prioritizedIds.length === 0) {
    return challenges
  }

  const prioritizedIdSet = new Set(prioritizedIds)

  return [
    ...challenges.filter((challenge) => prioritizedIdSet.has(challenge.id)),
    ...challenges.filter((challenge) => !prioritizedIdSet.has(challenge.id)),
  ]
}

export function saveRecentAffectedChallengeIds(challengeIds: string[]) {
  if (typeof window === 'undefined') {
    return
  }

  const uniqueIds = Array.from(new Set(challengeIds.filter((id) => typeof id === 'string' && id.length > 0)))

  window.sessionStorage.setItem(
    RECENT_AFFECTED_CHALLENGES_STORAGE_KEY,
    JSON.stringify({
      ids: uniqueIds,
      savedAt: Date.now(),
    })
  )
}

export function loadRecentAffectedChallengeIds() {
  if (typeof window === 'undefined') {
    return [] as string[]
  }

  const rawValue = window.sessionStorage.getItem(RECENT_AFFECTED_CHALLENGES_STORAGE_KEY)

  if (!rawValue) {
    return [] as string[]
  }

  try {
    const parsed = JSON.parse(rawValue) as {
      ids?: unknown
      savedAt?: unknown
    }

    if (!Array.isArray(parsed.ids) || typeof parsed.savedAt !== 'number') {
      window.sessionStorage.removeItem(RECENT_AFFECTED_CHALLENGES_STORAGE_KEY)
      return [] as string[]
    }

    if (Date.now() - parsed.savedAt > RECENT_AFFECTED_CHALLENGES_MAX_AGE_MS) {
      window.sessionStorage.removeItem(RECENT_AFFECTED_CHALLENGES_STORAGE_KEY)
      return [] as string[]
    }

    return parsed.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  } catch {
    window.sessionStorage.removeItem(RECENT_AFFECTED_CHALLENGES_STORAGE_KEY)
    return [] as string[]
  }
}
