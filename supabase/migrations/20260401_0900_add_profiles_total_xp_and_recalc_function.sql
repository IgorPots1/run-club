alter table public.profiles
add column if not exists total_xp integer;

alter table public.profiles
alter column total_xp set default 0;

update public.profiles
set total_xp = 0
where total_xp is null;

alter table public.profiles
alter column total_xp set not null;

update public.profiles p
set total_xp =
  coalesce((
    select coalesce(sum(coalesce(r.xp, 0)), 0)::integer
    from public.runs r
    where r.user_id = p.id
  ), 0)
  + coalesce((
    select coalesce(sum(coalesce(ch.xp_reward, 0)), 0)::integer
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    where uc.user_id = p.id
  ), 0)
  + coalesce((
    select coalesce(count(*), 0)::integer * 5
    from public.run_likes rl
    join public.runs r
      on r.id = rl.run_id
    where r.user_id = p.id
  ), 0);

create or replace function public.recalculate_user_total_xp(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with run_xp as (
    select coalesce(sum(coalesce(r.xp, 0)), 0)::integer as total
    from public.runs r
    where r.user_id = p_user_id
  ),
  challenge_xp as (
    select coalesce(sum(coalesce(ch.xp_reward, 0)), 0)::integer as total
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    where uc.user_id = p_user_id
  ),
  like_xp as (
    select coalesce(count(*), 0)::integer * 5 as total
    from public.run_likes rl
    join public.runs r
      on r.id = rl.run_id
    where r.user_id = p_user_id
  )
  select
    coalesce((select total from run_xp), 0)
    + coalesce((select total from challenge_xp), 0)
    + coalesce((select total from like_xp), 0);
$$;

update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id);
