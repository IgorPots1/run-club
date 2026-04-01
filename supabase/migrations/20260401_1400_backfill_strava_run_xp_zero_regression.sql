-- Backfill the narrow Strava regression window where a few runs were inserted
-- with `runs.xp = 0` even though they are awardable under the current rules.
-- This update is idempotent and relies on the existing `public.runs` XP delta
-- triggers to propagate the corrected XP into `profiles.total_xp`.

with corrected_runs as (
  select *
  from (
    values
      ('02f422da-004b-4ba1-97c4-a6e7b438b322'::uuid, 181),
      ('954213d2-ac0d-460d-bada-95cd5467580e'::uuid, 240),
      ('11d9a3c0-821a-4c65-bcf5-8e1eca4c23d0'::uuid, 139)
  ) as v(id, expected_xp)
)
update public.runs r
set xp = c.expected_xp
from corrected_runs c
where r.id = c.id
  and coalesce(r.xp, 0) = 0;
