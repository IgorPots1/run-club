create or replace function public.get_weekly_xp_leaderboard()
returns table (
  user_id uuid,
  display_name text,
  total_xp integer,
  weekly_xp integer,
  challenge_xp integer,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with cutoff as (
    select timezone('utc', now()) - interval '7 days' as value
  ),
  run_xp as (
    select
      r.user_id,
      coalesce(sum(r.xp), 0)::integer as run_xp
    from public.runs r
    cross join cutoff c
    where r.created_at >= c.value
    group by r.user_id
  ),
  like_xp as (
    select
      r.user_id,
      (count(*) * 5)::integer as like_xp
    from public.run_likes rl
    join public.runs r
      on r.id = rl.run_id
    cross join cutoff c
    where rl.created_at >= c.value
    group by r.user_id
  ),
  challenge_xp as (
    select
      uc.user_id,
      coalesce(sum(ch.xp_reward), 0)::integer as challenge_xp
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    cross join cutoff c
    where uc.completed_at >= c.value
    group by uc.user_id
  ),
  combined as (
    select
      coalesce(rx.user_id, lx.user_id, cx.user_id) as user_id,
      coalesce(rx.run_xp, 0)::integer as run_xp,
      coalesce(lx.like_xp, 0)::integer as like_xp,
      coalesce(cx.challenge_xp, 0)::integer as challenge_xp
    from run_xp rx
    full outer join like_xp lx
      on lx.user_id = rx.user_id
    full outer join challenge_xp cx
      on cx.user_id = coalesce(rx.user_id, lx.user_id)
  ),
  ranked as (
    select
      c.user_id,
      coalesce(
        nullif(btrim(p.nickname), ''),
        nullif(btrim(p.name), ''),
        nullif(btrim(p.email), ''),
        'Бегун'
      ) as display_name,
      (c.run_xp + c.like_xp + c.challenge_xp)::integer as total_xp,
      (c.run_xp + c.like_xp + c.challenge_xp)::integer as weekly_xp,
      c.challenge_xp::integer as challenge_xp,
      row_number() over (
        order by (c.run_xp + c.like_xp + c.challenge_xp) desc, c.user_id asc
      ) as rank
    from combined c
    left join public.profiles p
      on p.id = c.user_id
  )
  select
    user_id,
    display_name,
    total_xp,
    weekly_xp,
    challenge_xp,
    rank
  from ranked
  order by rank asc;
$$;

revoke all on function public.get_weekly_xp_leaderboard() from public;
grant execute on function public.get_weekly_xp_leaderboard() to authenticated;
