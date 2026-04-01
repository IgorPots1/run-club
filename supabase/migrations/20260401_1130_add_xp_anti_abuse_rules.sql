update public.user_challenges uc
set xp_awarded = greatest(coalesce(ch.xp_reward, 0)::integer, 0)
from public.challenges ch
where ch.id = uc.challenge_id
  and uc.xp_awarded is distinct from greatest(coalesce(ch.xp_reward, 0)::integer, 0);

drop function if exists public.award_challenge_completion_badge(uuid, uuid);

create or replace function public.award_challenge_completion_badge(
  p_user_id uuid,
  p_challenge_id uuid,
  p_xp_awarded integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_completed_at timestamptz;
  v_title text;
  v_xp_reward integer := 0;
  v_xp_awarded integer := greatest(coalesce(p_xp_awarded, 0), 0);
  v_completion_inserted_count integer := 0;
  v_badge_inserted_count integer := 0;
begin
  select
    c.title,
    coalesce(c.xp_reward, 0)::integer
  into
    v_title,
    v_xp_reward
  from public.challenges c
  where c.id = p_challenge_id;

  if not found then
    raise exception 'Challenge % not found', p_challenge_id
      using errcode = 'P0002';
  end if;

  insert into public.user_challenges (
    user_id,
    challenge_id,
    completed_at,
    xp_awarded
  )
  values (
    p_user_id,
    p_challenge_id,
    v_now,
    v_xp_awarded
  )
  on conflict (user_id, challenge_id) do nothing;

  get diagnostics v_completion_inserted_count = row_count;

  select uc.completed_at
  into v_completed_at
  from public.user_challenges uc
  where uc.user_id = p_user_id
    and uc.challenge_id = p_challenge_id;

  insert into public.user_badge_awards (
    user_id,
    badge_code,
    race_week_id,
    source_type,
    source_rank,
    awarded_at,
    meta
  )
  values (
    p_user_id,
    'challenge_completion',
    null,
    'challenge',
    null,
    coalesce(v_completed_at, v_now),
    jsonb_build_object(
      'challenge_id', p_challenge_id,
      'title_snapshot', v_title,
      'xp_reward', v_xp_reward,
      'xp_awarded', v_xp_awarded
    )
  )
  on conflict do nothing;

  get diagnostics v_badge_inserted_count = row_count;

  return jsonb_build_object(
    'completion_created', v_completion_inserted_count > 0,
    'badge_created', v_badge_inserted_count > 0,
    'completed_at', coalesce(v_completed_at, v_now)
  );
end;
$$;

revoke all on function public.award_challenge_completion_badge(uuid, uuid, integer) from public;
revoke all on function public.award_challenge_completion_badge(uuid, uuid, integer) from anon;
revoke all on function public.award_challenge_completion_badge(uuid, uuid, integer) from authenticated;

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
      coalesce(sum(coalesce(uc.xp_awarded, 0)), 0)::integer as total
    from public.user_challenges uc
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
