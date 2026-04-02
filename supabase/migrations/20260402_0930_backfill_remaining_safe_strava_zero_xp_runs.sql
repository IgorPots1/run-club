-- Narrow follow-up repair for the remaining audited Strava runs that still had
-- `runs.xp = 0` after the earlier manual-only backfill.
--
-- These rows were verified against the current runtime rules and are clearly
-- repairable because each one:
-- - is a Strava run with awardable distance
-- - has no same-timestamp sibling row
-- - has no earlier run in the prior 10-minute anti-abuse window
-- - still has positive remaining daily XP at its timestamp
-- - yields a positive XP value under the current scoring rules
--
-- This migration is intentionally exact-ID and idempotent.

with corrected_runs as (
  select *
  from (
    values
      ('11d9a3c0-821a-4c65-bcf5-8e1eca4c23d0'::uuid, '77e7b39d-c95a-445f-ad7c-078406fead55'::uuid, 139),
      ('5de9eba1-0025-4b71-8ad9-731b8a085e54'::uuid, '4cec94f8-20a3-4dc2-b17b-3704482d5cc6'::uuid, 181),
      ('ee9e6cf9-c754-4d59-aeea-4cb00d874aa8'::uuid, '9c831c40-928d-4d0c-99f7-393b2b985290'::uuid, 180),
      ('c79b25b0-fd48-4b60-8884-b462c43ba0f6'::uuid, '7d2fa58b-d6bd-40fd-89b4-0d59d22734a6'::uuid, 220)
  ) as v(id, user_id, expected_xp)
),
updated_runs as (
  update public.runs r
  set xp = c.expected_xp
  from corrected_runs c
  where r.id = c.id
    and r.user_id = c.user_id
    and coalesce(r.xp, 0) = 0
  returning r.user_id
)
update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id)
where p.id in (
  select distinct ur.user_id
  from updated_runs ur
);
