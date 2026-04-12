-- Repair only the manual runs that are clearly safe to backfill after the
-- 2026-04-01 anti-abuse rollout started zeroing some manual rows because they
-- all shared the same synthetic noon timestamp.
--
-- Safe criteria:
-- 1. non-Strava runs
-- 2. `xp = 0`
-- 3. distance is still awardable under the current runtime threshold (>= 1 km)
-- 4. created during the known regression window (after anti-abuse shipped)
-- 5. no sibling run at the exact same timestamp for the same user
-- 6. no earlier run for the same user inside the 10-minute duplicate window
--
-- We then recalculate XP using the current runtime formula as closely as is
-- safely practical: base XP + piecewise distance XP + weekly consistency bonus,
-- capped by the user's prior same-day canonical XP usage before that run.

with regression_candidates as (
  select
    r.id,
    r.user_id,
    r.created_at,
    greatest(coalesce(r.distance_km, 0)::numeric, 0) as distance_km,
    (date_trunc('day', r.created_at at time zone 'utc') at time zone 'utc') as utc_day_start
  from public.runs r
  where r.user_id is not null
    and coalesce(r.xp, 0) = 0
    and coalesce(r.distance_km, 0) >= 1
    and coalesce(r.external_source, '') <> 'strava'
    and r.created_at >= timestamptz '2026-04-01T08:53:38Z'
    and not exists (
      select 1
      from public.runs r_same
      where r_same.user_id = r.user_id
        and r_same.id <> r.id
        and r_same.created_at = r.created_at
    )
    and not exists (
      select 1
      from public.runs r_prev
      where r_prev.user_id = r.user_id
        and r_prev.id <> r.id
        and r_prev.created_at >= r.created_at - interval '10 minutes'
        and r_prev.created_at < r.created_at
    )
),
scored_candidates as (
  select
    c.id,
    least(
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
          when coalesce(weekly.existing_run_count, 0) + 1 >= 5 then 50
          when coalesce(weekly.existing_run_count, 0) + 1 >= 3 then 30
          when coalesce(weekly.existing_run_count, 0) + 1 >= 2 then 15
          else 0
        end,
      greatest(
        250 - least(
          coalesce(prior_run.run_xp, 0)
          + coalesce(prior_challenge.challenge_xp, 0)
          + coalesce(prior_like.like_xp, 0),
          250
        ),
        0
      )
    )::integer as corrected_xp
  from regression_candidates c
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
    select coalesce(sum(greatest(coalesce(ch.xp_reward, 0)::integer, 0)), 0)::integer as challenge_xp
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
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
  ) prior_like on true
)
update public.runs r
set xp = s.corrected_xp
from scored_candidates s
where r.id = s.id
  and coalesce(r.xp, 0) = 0
  and s.corrected_xp > 0;
