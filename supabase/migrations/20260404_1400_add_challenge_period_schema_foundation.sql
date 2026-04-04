do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n
      on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'challenge_goal_unit'
  ) then
    create type public.challenge_goal_unit as enum ('distance_km', 'run_count');
  end if;
end
$$;

alter type public.challenge_goal_unit add value if not exists 'distance_km';
alter type public.challenge_goal_unit add value if not exists 'run_count';

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n
      on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'challenge_period_type'
  ) then
    create type public.challenge_period_type as enum ('lifetime', 'challenge', 'weekly', 'monthly');
  end if;
end
$$;

alter type public.challenge_period_type add value if not exists 'lifetime';
alter type public.challenge_period_type add value if not exists 'challenge';
alter type public.challenge_period_type add value if not exists 'weekly';
alter type public.challenge_period_type add value if not exists 'monthly';

alter table public.challenges
add column if not exists goal_unit public.challenge_goal_unit;

alter table public.challenges
add column if not exists period_type public.challenge_period_type;

alter table public.challenges
add column if not exists goal_target numeric;

alter table public.challenges
alter column goal_unit set default 'distance_km'::public.challenge_goal_unit;

alter table public.challenges
alter column period_type set default 'lifetime'::public.challenge_period_type;

update public.challenges
set goal_unit = case
  when coalesce(goal_runs, 0) > 0 and coalesce(goal_km, 0) <= 0
    then 'run_count'::public.challenge_goal_unit
  else 'distance_km'::public.challenge_goal_unit
end
where goal_unit is null;

update public.challenges
set period_type = 'lifetime'::public.challenge_period_type
where period_type is null;

update public.challenges
set goal_target = case
  when coalesce(goal_runs, 0) > 0 and coalesce(goal_km, 0) <= 0
    then goal_runs::numeric
  when coalesce(goal_km, 0) > 0
    then goal_km::numeric
  when coalesce(goal_runs, 0) > 0
    then goal_runs::numeric
  else goal_target
end
where goal_target is null;

alter table public.challenges
alter column goal_unit set not null;

alter table public.challenges
alter column period_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'challenges_goal_target_positive_check'
      and conrelid = 'public.challenges'::regclass
  ) then
    alter table public.challenges
    add constraint challenges_goal_target_positive_check
    check (goal_target is null or goal_target > 0);
  end if;
end
$$;

alter table public.user_challenges
add column if not exists period_key text;

alter table public.user_challenges
add column if not exists period_start timestamptz;

alter table public.user_challenges
add column if not exists period_end timestamptz;

do $$
declare
  v_user_id_attnum smallint;
  v_challenge_id_attnum smallint;
  v_constraint_name text;
begin
  select attnum
  into v_user_id_attnum
  from pg_attribute
  where attrelid = 'public.user_challenges'::regclass
    and attname = 'user_id'
    and not attisdropped;

  select attnum
  into v_challenge_id_attnum
  from pg_attribute
  where attrelid = 'public.user_challenges'::regclass
    and attname = 'challenge_id'
    and not attisdropped;

  select conname
  into v_constraint_name
  from pg_constraint
  where conrelid = 'public.user_challenges'::regclass
    and contype = 'u'
    and conkey = array[v_user_id_attnum, v_challenge_id_attnum]::smallint[]
  limit 1;

  if v_constraint_name is not null then
    execute format(
      'alter table public.user_challenges drop constraint %I',
      v_constraint_name
    );
  end if;
end
$$;

create unique index if not exists user_challenges_lifetime_unique_idx
on public.user_challenges (user_id, challenge_id)
where period_key is null;

create unique index if not exists user_challenges_period_unique_idx
on public.user_challenges (user_id, challenge_id, period_key)
where period_key is not null;

create index if not exists user_challenges_user_id_challenge_id_period_start_idx
on public.user_challenges (user_id, challenge_id, period_start desc)
where period_key is not null;

create or replace function public.award_challenge_completion_badge(
  p_user_id uuid,
  p_challenge_id uuid
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
    completed_at
  )
  values (
    p_user_id,
    p_challenge_id,
    v_now
  )
  on conflict (user_id, challenge_id) where period_key is null do nothing;

  get diagnostics v_completion_inserted_count = row_count;

  select uc.completed_at
  into v_completed_at
  from public.user_challenges uc
  where uc.user_id = p_user_id
    and uc.challenge_id = p_challenge_id
    and uc.period_key is null
  order by uc.completed_at asc
  limit 1;

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
      'xp_awarded', v_xp_reward
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

revoke all on function public.award_challenge_completion_badge(uuid, uuid) from public;
revoke all on function public.award_challenge_completion_badge(uuid, uuid) from anon;
revoke all on function public.award_challenge_completion_badge(uuid, uuid) from authenticated;

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
        and uc.period_key is null
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
    on conflict (user_id, challenge_id) where period_key is null do nothing
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
