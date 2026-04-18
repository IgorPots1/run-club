-- Repair runs that were incorrectly zeroed when daily XP usage considered the
-- full day instead of only usage earlier than the run timestamp.
--
-- Safety constraints:
-- - only rows with runs.xp = 0
-- - keep min-distance rule unchanged (exclude distance_km < 1)
-- - keep duplicate-window rule unchanged (exclude runs with another run in the
--   same user's prior 10-minute window, including same-timestamp siblings)
-- - only update rows that become positive under the corrected timestamp-bounded
--   daily usage calculation
--
-- This is idempotent and returns each repaired row for explicit review.

with candidate_runs as (
  select
    r.id,
    r.user_id,
    r.created_at,
    greatest(coalesce(r.distance_km, 0)::numeric, 0) as distance_km,
    greatest(coalesce(r.elevation_gain_meters, 0)::numeric, 0) as elevation_gain_meters,
    nullif(btrim(coalesce(r.external_source, '')), '') as external_source,
    (date_trunc('day', r.created_at at time zone 'utc') at time zone 'utc') as utc_day_start
  from public.runs r
  where r.user_id is not null
    and coalesce(r.xp, 0) = 0
    and coalesce(r.distance_km, 0) >= 1
    and not exists (
      select 1
      from public.runs r_dupe
      where r_dupe.user_id = r.user_id
        and r_dupe.id <> r.id
        and r_dupe.created_at >= r.created_at - interval '10 minutes'
        and r_dupe.created_at <= r.created_at
    )
),
scored_candidates as (
  select
    c.id,
    c.user_id,
    c.created_at,
    (
      40
      + greatest(
          round(
            (least(c.distance_km, 10) * 9)
            + (least(greatest(c.distance_km - 10, 0), 10) * 7)
            + (greatest(c.distance_km - 20, 0) * 5)
          ),
          0
        )::integer
      + case
          when c.external_source is not null and c.distance_km >= 3
            then least(floor(c.elevation_gain_meters / 20), 25)::integer
          else 0
        end
      + case
          when coalesce(weekly.existing_run_count, 0) + 1 >= 5 then 50
          when coalesce(weekly.existing_run_count, 0) + 1 >= 3 then 30
          when coalesce(weekly.existing_run_count, 0) + 1 >= 2 then 15
          else 0
        end
    )::integer as raw_xp,
    least(
      (
        40
        + greatest(
            round(
              (least(c.distance_km, 10) * 9)
              + (least(greatest(c.distance_km - 10, 0), 10) * 7)
              + (greatest(c.distance_km - 20, 0) * 5)
            ),
            0
          )::integer
        + case
            when c.external_source is not null and c.distance_km >= 3
              then least(floor(c.elevation_gain_meters / 20), 25)::integer
            else 0
          end
        + case
            when coalesce(weekly.existing_run_count, 0) + 1 >= 5 then 50
            when coalesce(weekly.existing_run_count, 0) + 1 >= 3 then 30
            when coalesce(weekly.existing_run_count, 0) + 1 >= 2 then 15
            else 0
          end
      )::integer,
      greatest(
        250 - least(
          coalesce(prior_run.run_xp, 0)
          + coalesce(prior_challenge.challenge_xp, 0)
          + coalesce(prior_likes.like_xp, 0),
          250
        ),
        0
      )
    )::integer as corrected_xp
  from candidate_runs c
  left join lateral (
    select count(*)::integer as existing_run_count
    from public.runs r_week
    where r_week.user_id = c.user_id
      and r_week.id <> c.id
      and r_week.created_at >= c.created_at - interval '7 days'
      and r_week.created_at <= c.created_at
  ) weekly on true
  left join lateral (
    select coalesce(sum(greatest(coalesce(r_day.xp, 0)::integer, 0)), 0)::integer as run_xp
    from public.runs r_day
    where r_day.user_id = c.user_id
      and r_day.id <> c.id
      and r_day.created_at >= c.utc_day_start
      and r_day.created_at < c.created_at
  ) prior_run on true
  left join lateral (
    select coalesce(sum(greatest(coalesce(uc.awarded_xp, 0), 0)), 0)::integer as challenge_xp
    from public.user_challenges uc
    where uc.user_id = c.user_id
      and uc.completed_at >= c.utc_day_start
      and uc.completed_at < c.created_at
  ) prior_challenge on true
  left join lateral (
    select (least(count(*), 10) * 5)::integer as like_xp
    from public.run_likes rl
    where rl.run_owner_user_id = c.user_id
      and coalesce(rl.xp_awarded, 0) > 0
      and rl.created_at >= c.utc_day_start
      and rl.created_at < c.created_at
  ) prior_likes on true
),
repairable_runs as (
  select
    s.id,
    s.user_id,
    s.created_at,
    s.raw_xp,
    s.corrected_xp
  from scored_candidates s
  where s.corrected_xp > 0
),
updated_runs as (
  update public.runs r
  set xp = rr.corrected_xp
  from repairable_runs rr
  where r.id = rr.id
    and coalesce(r.xp, 0) = 0
  returning
    r.id,
    r.user_id,
    r.created_at,
    0::integer as previous_xp,
    rr.raw_xp,
    rr.corrected_xp as new_xp
)
select *
from updated_runs
order by created_at, id;
