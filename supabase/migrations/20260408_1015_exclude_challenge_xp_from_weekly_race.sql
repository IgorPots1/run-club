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
  with current_week as (
    select
      rw.id,
      rw.starts_at,
      rw.ends_at
    from public.resolve_current_race_week() rw
  ),
  run_xp as (
    select
      r.user_id,
      coalesce(sum(r.xp), 0)::integer as run_xp
    from public.runs r
    join current_week w
      on r.created_at >= w.starts_at
     and r.created_at < w.ends_at
    group by r.user_id
  ),
  like_xp as (
    select
      r.user_id,
      (count(*) * 5)::integer as like_xp
    from public.run_likes rl
    join public.runs r
      on r.id = rl.run_id
    join current_week w
      on rl.created_at >= w.starts_at
     and rl.created_at < w.ends_at
    group by r.user_id
  ),
  combined as (
    select
      coalesce(rx.user_id, lx.user_id) as user_id,
      coalesce(rx.run_xp, 0)::integer as run_xp,
      coalesce(lx.like_xp, 0)::integer as like_xp
    from run_xp rx
    full outer join like_xp lx
      on lx.user_id = rx.user_id
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
      (c.run_xp + c.like_xp)::integer as total_xp,
      (c.run_xp + c.like_xp)::integer as weekly_xp,
      0::integer as challenge_xp,
      row_number() over (
        order by (c.run_xp + c.like_xp) desc, c.user_id asc
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
