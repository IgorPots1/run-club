create or replace function public.finalize_earned_challenges_for_user(p_user_id uuid)
returns table (
  out_challenge_id uuid,
  xp_awarded integer,
  completed_at timestamptz,
  badge_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
begin
  return query
  with user_run_totals as (
    select
      coalesce(sum(coalesce(r.distance_km, 0)), 0)::numeric as total_km,
      count(*)::integer as total_runs
    from public.runs r
    where r.user_id = p_user_id
  ),
  eligible_challenges as (
    select
      ch.id as challenge_id,
      greatest(coalesce(ch.xp_reward, 0)::integer, 0) as xp_awarded,
      ch.title as title_snapshot
    from public.challenges ch
    cross join user_run_totals urt
    where not exists (
      select 1
      from public.user_challenges uc
      where uc.user_id = p_user_id
        and uc.challenge_id = ch.id
    )
      and (
        coalesce(ch.visibility, 'public') = 'public'
        or (
          coalesce(ch.visibility, 'public') = 'restricted'
          and exists (
            select 1
            from public.challenge_access_users cau
            where cau.challenge_id = ch.id
              and cau.user_id = p_user_id
          )
        )
      )
      and (
        (
          ch.goal_km is not null
          and ch.goal_km > 0
          and urt.total_km >= ch.goal_km
        )
        or (
          ch.goal_runs is not null
          and ch.goal_runs > 0
          and urt.total_runs >= ch.goal_runs
        )
      )
  ),
  inserted_completions as (
    insert into public.user_challenges as uc (
      user_id,
      challenge_id,
      completed_at
    )
    select
      p_user_id,
      ec.challenge_id,
      v_now
    from eligible_challenges ec
    on conflict (user_id, challenge_id) do nothing
    returning uc.challenge_id, uc.completed_at
  ),
  inserted_badges as (
    insert into public.user_badge_awards (
      user_id,
      badge_code,
      race_week_id,
      source_type,
      source_rank,
      awarded_at,
      meta
    )
    select
      p_user_id,
      'challenge_completion',
      null,
      'challenge',
      null,
      ic.completed_at,
      jsonb_build_object(
        'challenge_id', ec.challenge_id,
        'title_snapshot', ec.title_snapshot,
        'xp_awarded', ec.xp_awarded
      )
    from inserted_completions ic
    join eligible_challenges ec
      on ec.challenge_id = ic.challenge_id
    on conflict do nothing
    returning (meta ->> 'challenge_id')::uuid as badge_challenge_id
  )
  select
    ec.challenge_id as out_challenge_id,
    ec.xp_awarded,
    ic.completed_at,
    ib.badge_challenge_id is not null as badge_created
  from inserted_completions ic
  join eligible_challenges ec
    on ec.challenge_id = ic.challenge_id
  left join inserted_badges ib
    on ib.badge_challenge_id = ic.challenge_id
  order by ic.completed_at asc, ec.challenge_id asc;
end;
$$;

revoke all on function public.finalize_earned_challenges_for_user(uuid) from public;
revoke all on function public.finalize_earned_challenges_for_user(uuid) from anon;
revoke all on function public.finalize_earned_challenges_for_user(uuid) from authenticated;
grant execute on function public.finalize_earned_challenges_for_user(uuid) to service_role;
