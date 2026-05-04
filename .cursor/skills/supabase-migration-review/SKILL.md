---
name: supabase-migration-review
description: Review Run Club Supabase schema, RLS, auth, and data-access changes. Use for migrations, policies, DB services, API routes, or service role changes.
disable-model-invocation: true
---

# Supabase Migration Review

## Checklist

- Confirm every schema change has a migration in `supabase/migrations`.
- Verify RLS policies remain safe and least-privilege.
- Confirm service role usage is server-only and never reachable from client code.
- Check TypeScript types and data-access services are updated when schema changes.
- Consider query and index impact for new access patterns.
- Preserve `app_access_status` and user visibility boundaries.
- Confirm no direct production DB workaround is used instead of a migration.

## Output

- Findings ordered by severity
- Migration and RLS status
- Type/service update status
- Query/index notes
- Required fixes before merge
