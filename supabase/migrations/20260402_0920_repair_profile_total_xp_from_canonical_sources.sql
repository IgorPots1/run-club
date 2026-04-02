-- Reassert the current canonical total XP recompute function and refresh every
-- profile from live stored sources after restoring run XP propagation and
-- backfilling obviously broken manual run rows.

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
