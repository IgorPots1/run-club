export {
  ensureHistoricalPersonalRecordBackfillForUser,
  loadHistoricalPersonalRecordBackfillStateForUser,
  runHistoricalPersonalRecordBackfillForUser,
} from '../lib/personal-records/runHistoricalPersonalRecordBackfillForUser.mjs'
import {
  runHistoricalPersonalRecordBackfillScript,
} from '../lib/personal-records/runHistoricalPersonalRecordBackfillForUser.mjs'

function parseArgs(argv) {
  const args = {
    userId: null,
    dryRun: false,
  }

  for (const argument of argv) {
    if (argument === '--dry-run') {
      args.dryRun = true
      continue
    }

    if (argument.startsWith('--user-id=')) {
      args.userId = argument.slice('--user-id='.length).trim() || null
    }
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await runHistoricalPersonalRecordBackfillScript(args)
}

const isDirectExecution = Boolean(
  process.argv[1]
  && new URL(import.meta.url).pathname === process.argv[1]
)

if (isDirectExecution) {
  main().catch((error) => {
    console.error('Personal record backfill failed', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    process.exitCode = 1
  })
}
