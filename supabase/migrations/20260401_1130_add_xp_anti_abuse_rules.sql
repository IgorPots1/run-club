create or replace function public.recalculate_user_total_xp(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with daily_run_xp as (
    select
      (r.created_at at time zone 'utc')::date as xp_date,
      coalesce(sum(coalesce(r.xp, 0)), 0)::integer as total
    from public.runs r
    where r.user_id = p_user_id
    group by (r.created_at at time zone 'utc')::date
  ),
  daily_challenge_xp as (
    select
      (uc.completed_at at time zone 'utc')::date as xp_date,
      coalesce(sum(greatest(coalesce(ch.xp_reward, 0)::integer, 0)), 0)::integer as total
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    where uc.user_id = p_user_id
    group by (uc.completed_at at time zone 'utc')::date
  ),
  daily_like_counts as (
    select
      (rl.created_at at time zone 'utc')::date as xp_date,
      count(*)::integer as like_count
    from public.run_likes rl
    join public.runs r
      on r.id = rl.run_id
    where r.user_id = p_user_id
    group by (rl.created_at at time zone 'utc')::date
  ),
  daily_like_xp as (
    select
      dlc.xp_date,
      (least(dlc.like_count, 10) * 5)::integer as total
    from daily_like_counts dlc
  ),
  xp_dates as (
    select drx.xp_date from daily_run_xp drx
    union
    select dcx.xp_date from daily_challenge_xp dcx
    union
    select dlx.xp_date from daily_like_xp dlx
  ),
  capped_daily_xp as (
    select
      xd.xp_date,
      least(
        coalesce(drx.total, 0) + coalesce(dcx.total, 0) + coalesce(dlx.total, 0),
        250
      )::integer as total
    from xp_dates xd
    left join daily_run_xp drx
      on drx.xp_date = xd.xp_date
    left join daily_challenge_xp dcx
      on dcx.xp_date = xd.xp_date
    left join daily_like_xp dlx
      on dlx.xp_date = xd.xp_date
  ),
  race_bonus_xp as (
    select coalesce(sum(coalesce(rwr.race_bonus_xp, 0)), 0)::integer as total
    from public.race_week_results rwr
    where rwr.user_id = p_user_id
  )
  select
    coalesce((select coalesce(sum(cdx.total), 0)::integer from capped_daily_xp cdx), 0)
    + coalesce((select total from race_bonus_xp), 0);
$$;

update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id);
