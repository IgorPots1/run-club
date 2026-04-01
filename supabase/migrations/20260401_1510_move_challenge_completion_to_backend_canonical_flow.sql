create or replace function public.apply_challenge_xp_to_profile_total_on_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_xp integer := 0;
  v_new_xp integer := 0;
begin
  if tg_op <> 'INSERT' then
    select greatest(coalesce(ch.xp_reward, 0)::integer, 0)
    into v_old_xp
    from public.challenges ch
    where ch.id = old.challenge_id;
  end if;

  if tg_op <> 'DELETE' then
    select greatest(coalesce(ch.xp_reward, 0)::integer, 0)
    into v_new_xp
    from public.challenges ch
    where ch.id = new.challenge_id;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is not null and v_new_xp > 0 then
      perform public.apply_profile_total_xp_delta(new.user_id, v_new_xp);
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.user_id is not null and v_old_xp > 0 then
      perform public.apply_profile_total_xp_delta(old.user_id, -v_old_xp);
    end if;

    return old;
  end if;

  if new.user_id is not distinct from old.user_id then
    if new.user_id is not null and (v_new_xp - v_old_xp) <> 0 then
      perform public.apply_profile_total_xp_delta(new.user_id, v_new_xp - v_old_xp);
    end if;

    return new;
  end if;

  if old.user_id is not null and v_old_xp > 0 then
    perform public.apply_profile_total_xp_delta(old.user_id, -v_old_xp);
  end if;

  if new.user_id is not null and v_new_xp > 0 then
    perform public.apply_profile_total_xp_delta(new.user_id, v_new_xp);
  end if;

  return new;
end;
$$;

drop trigger if exists user_challenges_apply_xp_to_profile_total_after_insert on public.user_challenges;
create trigger user_challenges_apply_xp_to_profile_total_after_insert
after insert on public.user_challenges
for each row
execute function public.apply_challenge_xp_to_profile_total_on_write();

drop trigger if exists user_challenges_apply_xp_to_profile_total_after_update on public.user_challenges;
create trigger user_challenges_apply_xp_to_profile_total_after_update
after update of user_id, challenge_id on public.user_challenges
for each row
execute function public.apply_challenge_xp_to_profile_total_on_write();

drop trigger if exists user_challenges_apply_xp_to_profile_total_after_delete on public.user_challenges;
create trigger user_challenges_apply_xp_to_profile_total_after_delete
after delete on public.user_challenges
for each row
execute function public.apply_challenge_xp_to_profile_total_on_write();

revoke all on function public.apply_challenge_xp_to_profile_total_on_write() from public;
revoke all on function public.apply_challenge_xp_to_profile_total_on_write() from anon;
revoke all on function public.apply_challenge_xp_to_profile_total_on_write() from authenticated;

create or replace function public.finalize_earned_challenges_for_user(p_user_id uuid)
returns table (
  challenge_id uuid,
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
    insert into public.user_challenges (
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
    returning challenge_id, completed_at
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
    returning (meta ->> 'challenge_id')::uuid as challenge_id
  )
  select
    ec.challenge_id,
    ec.xp_awarded,
    ic.completed_at,
    ib.challenge_id is not null as badge_created
  from inserted_completions ic
  join eligible_challenges ec
    on ec.challenge_id = ic.challenge_id
  left join inserted_badges ib
    on ib.challenge_id = ic.challenge_id
  order by ic.completed_at asc, ec.challenge_id asc;
end;
$$;

revoke all on function public.finalize_earned_challenges_for_user(uuid) from public;
revoke all on function public.finalize_earned_challenges_for_user(uuid) from anon;
revoke all on function public.finalize_earned_challenges_for_user(uuid) from authenticated;
grant execute on function public.finalize_earned_challenges_for_user(uuid) to service_role;

create or replace function public.finalize_earned_challenges_after_run_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is not null then
      perform public.finalize_earned_challenges_for_user(new.user_id);
    end if;

    return new;
  end if;

  if new.user_id is not null then
    perform public.finalize_earned_challenges_for_user(new.user_id);
  end if;

  return new;
end;
$$;

drop trigger if exists runs_finalize_earned_challenges_after_insert on public.runs;
create trigger runs_finalize_earned_challenges_after_insert
after insert on public.runs
for each row
execute function public.finalize_earned_challenges_after_run_write();

drop trigger if exists runs_finalize_earned_challenges_after_update on public.runs;
create trigger runs_finalize_earned_challenges_after_update
after update of user_id, distance_km on public.runs
for each row
execute function public.finalize_earned_challenges_after_run_write();

revoke all on function public.finalize_earned_challenges_after_run_write() from public;
revoke all on function public.finalize_earned_challenges_after_run_write() from anon;
revoke all on function public.finalize_earned_challenges_after_run_write() from authenticated;

do $$
declare
  v_profile record;
begin
  for v_profile in
    select p.id
    from public.profiles p
  loop
    perform public.finalize_earned_challenges_for_user(v_profile.id);
  end loop;
end
$$;

update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id);
