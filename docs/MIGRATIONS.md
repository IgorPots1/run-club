# Safe Supabase Migration Workflow

This project uses a conservative migration workflow for the live production database.

## Production Workflow

1. Create a new migration with `npm run db:new -- <name>`.
2. Review the generated SQL carefully before applying anything.
3. Commit the migration file to the repository.
4. Apply the migration to the production database manually with `npm run db:push`.
5. If migration history conflicts or version mismatches exist, prefer applying the SQL manually in the Supabase SQL Editor instead of forcing migration state changes.
6. Verify the expected production database objects after the change, including tables, columns, indexes, constraints, functions, triggers, and policies as relevant.
7. Deploy application code only after the database changes are confirmed in production.

## Helpful Commands

- `npm run db:login`
- `npm run db:link`
- `npm run db:diff`
- `npm run db:remote`
- `npm run db:push`

## Notes

- Do not automate production migration execution in CI or deploy hooks for this project.
- When in doubt, prefer a slower manual rollout over trying to repair migration history automatically.
