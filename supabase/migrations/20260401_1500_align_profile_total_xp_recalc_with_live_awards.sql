create or replace function public.get_daily_xp_usage(
  p_user_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with run_xp as (
    select coalesce(sum(greatest(coalesce(r.xp, 0)::integer, 0)), 0)::integer as total
    from public.runs r
    where r.user_id = p_user_id
      and r.created_at >= p_start
      and r.created_at < p_end
  ),
  challenge_xp as (
    select coalesce(sum(greatest(coalesce(ch.xp_reward, 0)::integer, 0)), 0)::integer as total
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    where uc.user_id = p_user_id
      and uc.completed_at >= p_start
      and uc.completed_at < p_end
  ),
  received_likes as (
    select coalesce(count(*), 0)::integer as total
    from public.run_likes rl
    where rl.run_owner_user_id = p_user_id
      and coalesce(rl.xp_awarded, 0) > 0
      and rl.created_at >= p_start
      and rl.created_at < p_end
  )
  select jsonb_build_object(
    'runXp', coalesce((select total from run_xp), 0),
    'challengeXp', coalesce((select total from challenge_xp), 0),
    'receivedLikesCount', coalesce((select total from received_likes), 0)
  );
$$;

revoke all on function public.get_daily_xp_usage(uuid, timestamptz, timestamptz) from public;
revoke all on function public.get_daily_xp_usage(uuid, timestamptz, timestamptz) from anon;
revoke all on function public.get_daily_xp_usage(uuid, timestamptz, timestamptz) from authenticated;

create or replace function public.recalculate_user_total_xp(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with run_xp as (
    select coalesce(sum(greatest(coalesce(r.xp, 0)::integer, 0)), 0)::integer as total
    from public.runs r
    where r.user_id = p_user_id
  ),
  challenge_xp as (
    select coalesce(sum(greatest(coalesce(ch.xp_reward, 0)::integer, 0)), 0)::integer as total
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    where uc.user_id = p_user_id
  ),
  like_xp as (
    select coalesce(sum(greatest(coalesce(rl.xp_awarded, 0)::integer, 0)), 0)::integer as total
    from public.run_likes rl
    where rl.run_owner_user_id = p_user_id
  ),
  race_bonus_xp as (
    select coalesce(sum(greatest(coalesce(rwr.race_bonus_xp, 0)::integer, 0)), 0)::integer as total
    from public.race_week_results rwr
    where rwr.user_id = p_user_id
  )
  select
    coalesce((select total from run_xp), 0)
    + coalesce((select total from challenge_xp), 0)
    + coalesce((select total from like_xp), 0)
    + coalesce((select total from race_bonus_xp), 0);
$$;

update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id);
