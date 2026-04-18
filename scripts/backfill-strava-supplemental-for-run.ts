import { hydrateRunSupplementalStravaDataForRun } from '../lib/strava/strava-sync'

type Args = {
  userId: string
  runId: string
  activityId: number
  ignoreCooldown: boolean
}

function parsePositiveInteger(value: string, flagName: string) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }

  return parsed
}

function parseArgs(argv: string[]): Args {
  let userId = ''
  let runId = ''
  let activityId: number | null = null
  let ignoreCooldown = true

  for (const argument of argv) {
    if (argument.startsWith('--user-id=')) {
      userId = argument.slice('--user-id='.length).trim()
      continue
    }

    if (argument.startsWith('--run-id=')) {
      runId = argument.slice('--run-id='.length).trim()
      continue
    }

    if (argument.startsWith('--activity-id=')) {
      activityId = parsePositiveInteger(argument.slice('--activity-id='.length), '--activity-id')
      continue
    }

    if (argument === '--respect-cooldown') {
      ignoreCooldown = false
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  if (!userId) {
    throw new Error('Missing required argument --user-id=<uuid>')
  }

  if (!runId) {
    throw new Error('Missing required argument --run-id=<uuid>')
  }

  if (activityId == null) {
    throw new Error('Missing required argument --activity-id=<strava-id>')
  }

  return {
    userId,
    runId,
    activityId,
    ignoreCooldown,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.info('Starting Strava supplemental hydration backfill for run', {
    userId: args.userId,
    runId: args.runId,
    activityId: args.activityId,
    ignoreCooldown: args.ignoreCooldown,
  })

  const hydrated = await hydrateRunSupplementalStravaDataForRun({
    userId: args.userId,
    runId: args.runId,
    stravaActivityId: args.activityId,
    ignoreCooldown: args.ignoreCooldown,
  })

  console.info('Strava supplemental hydration backfill complete', {
    userId: args.userId,
    runId: args.runId,
    activityId: args.activityId,
    hydrated,
  })
}

main().catch((error) => {
  console.error('Strava supplemental hydration backfill failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
