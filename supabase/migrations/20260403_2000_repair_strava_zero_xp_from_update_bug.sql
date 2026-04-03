-- Repair audited Strava runs that were left with `runs.xp = 0` by the earlier
-- update bug. Keep this migration exact-ID and idempotent:
-- 1. run `npx tsx scripts/generate-strava-zero-xp-repair.ts --sql-values`
-- 2. review the repairable rows and skipped reasons
-- 3. paste only the audited VALUES rows below

with corrected_runs as (
  select
    v.id,
    v.user_id,
    v.expected_xp
  from (
    values
      (null::uuid, null::uuid, null::integer)
      -- Replace this placeholder row with audited rows from the script, for example:
      -- ('run-id'::uuid, 'user-id'::uuid, 123)
  ) as v(id, user_id, expected_xp)
  where v.id is not null
),
updated_runs as (
  update public.runs r
  set xp = c.expected_xp
  from corrected_runs c
  where r.id = c.id
    and r.user_id = c.user_id
    and r.external_source = 'strava'
    and coalesce(r.xp, 0) = 0
    and coalesce(c.expected_xp, 0) > 0
  returning r.user_id
)
update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id)
where p.id in (
  select distinct ur.user_id
  from updated_runs ur
);
