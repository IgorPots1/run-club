alter table public.challenges
add column if not exists starts_at timestamptz;

alter table public.challenges
add column if not exists end_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'challenges_time_window_check'
      and conrelid = 'public.challenges'::regclass
  ) then
    alter table public.challenges
    add constraint challenges_time_window_check
    check (
      starts_at is null
      or end_at is null
      or end_at > starts_at
    );
  end if;
end
$$;

alter table public.user_challenges
add column if not exists awarded_xp integer;

alter table public.user_challenges
add column if not exists title_snapshot text;

update public.user_challenges uc
set
  awarded_xp = greatest(coalesce(ch.xp_reward, 0)::integer, 0),
  title_snapshot = coalesce(nullif(trim(ch.title), ''), 'Челлендж')
from public.challenges ch
where ch.id = uc.challenge_id
  and (
    uc.awarded_xp is null
    or uc.title_snapshot is null
    or btrim(uc.title_snapshot) = ''
  );

update public.user_challenges
set awarded_xp = 0
where awarded_xp is null;

update public.user_challenges
set title_snapshot = 'Челлендж'
where title_snapshot is null
  or btrim(title_snapshot) = '';

alter table public.user_challenges
alter column awarded_xp set default 0;

alter table public.user_challenges
alter column awarded_xp set not null;

alter table public.user_challenges
alter column title_snapshot set default 'Челлендж';

alter table public.user_challenges
alter column title_snapshot set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_challenges_awarded_xp_nonnegative_check'
      and conrelid = 'public.user_challenges'::regclass
  ) then
    alter table public.user_challenges
    add constraint user_challenges_awarded_xp_nonnegative_check
    check (awarded_xp >= 0);
  end if;
end
$$;

drop index if exists public.user_badge_awards_challenge_completion_unique_idx;

create unique index if not exists user_badge_awards_challenge_completion_period_unique_idx
on public.user_badge_awards (
  user_id,
  badge_code,
  source_type,
  ((meta ->> 'challenge_id')),
  (coalesce((meta ->> 'period_key'), ''))
)
where source_type = 'challenge'
  and badge_code = 'challenge_completion';

create or replace function public.resolve_challenge_period_window(
  p_period_type public.challenge_period_type,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reference_at timestamptz default timezone('utc', now())
)
returns table (
  is_eligible boolean,
  period_key text,
  period_start timestamptz,
  period_end timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reference_at timestamptz := coalesce(p_reference_at, timezone('utc', now()));
  v_reference_utc timestamp without time zone := v_reference_at at time zone 'utc';
begin
  if p_period_type = 'lifetime'::public.challenge_period_type then
    return query
    select
      true,
      null::text,
      null::timestamptz,
      null::timestamptz;
    return;
  end if;

  if p_period_type = 'challenge'::public.challenge_period_type then
    if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
      return query
      select
        false,
        null::text,
        null::timestamptz,
        null::timestamptz;
      return;
    end if;

    return query
    select
      true,
      null::text,
      p_starts_at,
      p_ends_at;
    return;
  end if;

  if p_period_type = 'weekly'::public.challenge_period_type then
    return query
    select
      true,
      to_char(v_reference_utc, 'IYYY-"W"IW'),
      (date_trunc('week', v_reference_utc) at time zone 'utc'),
      ((date_trunc('week', v_reference_utc) + interval '1 week') at time zone 'utc');
    return;
  end if;

  if p_period_type = 'monthly'::public.challenge_period_type then
    return query
    select
      true,
      to_char(v_reference_utc, 'YYYY-MM'),
      (date_trunc('month', v_reference_utc) at time zone 'utc'),
      ((date_trunc('month', v_reference_utc) + interval '1 month') at time zone 'utc');
    return;
  end if;

  return query
  select
    false,
    null::text,
    null::timestamptz,
    null::timestamptz;
end;
$$;

revoke all on function public.resolve_challenge_period_window(
  public.challenge_period_type,
  timestamptz,
  timestamptz,
  timestamptz
) from public;

revoke all on function public.resolve_challenge_period_window(
  public.challenge_period_type,
  timestamptz,
  timestamptz,
  timestamptz
) from anon;

revoke all on function public.resolve_challenge_period_window(
  public.challenge_period_type,
  timestamptz,
  timestamptz,
  timestamptz
) from authenticated;

create or replace function public.get_challenge_completion_for_user(
  p_user_id uuid,
  p_challenge_id uuid,
  p_reference_at timestamptz default timezone('utc', now())
)
returns table (
  completed_at timestamptz,
  awarded_xp integer,
  title_snapshot text,
  period_key text,
  period_start timestamptz,
  period_end timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with target_challenge as (
    select
      ch.id,
      ch.period_type,
      ch.starts_at,
      ch.end_at
    from public.challenges ch
    where ch.id = p_challenge_id
  ),
  resolved_period as (
    select
      rp.is_eligible,
      rp.period_key,
      rp.period_start,
      rp.period_end
    from target_challenge ch
    cross join lateral public.resolve_challenge_period_window(
      ch.period_type,
      ch.starts_at,
      ch.end_at,
      p_reference_at
    ) rp
  )
  select
    uc.completed_at,
    uc.awarded_xp,
    uc.title_snapshot,
    uc.period_key,
    uc.period_start,
    uc.period_end
  from public.user_challenges uc
  join resolved_period rp
    on rp.is_eligible
  where uc.user_id = p_user_id
    and uc.challenge_id = p_challenge_id
    and uc.period_key is not distinct from rp.period_key
  order by uc.completed_at desc
  limit 1;
$$;

revoke all on function public.get_challenge_completion_for_user(uuid, uuid, timestamptz) from public;
revoke all on function public.get_challenge_completion_for_user(uuid, uuid, timestamptz) from anon;
revoke all on function public.get_challenge_completion_for_user(uuid, uuid, timestamptz) from authenticated;
grant execute on function public.get_challenge_completion_for_user(uuid, uuid, timestamptz) to service_role;

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
    v_old_xp := greatest(coalesce(old.awarded_xp, 0), 0);
  end if;

  if tg_op <> 'DELETE' then
    v_new_xp := greatest(coalesce(new.awarded_xp, 0), 0);
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
after update of user_id, awarded_xp on public.user_challenges
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

create or replace function public.create_challenge_completed_app_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge_title text := 'Челлендж';
  v_xp_awarded integer := 0;
begin
  if new.user_id is null or new.challenge_id is null then
    return new;
  end if;

  v_challenge_title := coalesce(nullif(trim(new.title_snapshot), ''), 'Челлендж');
  v_xp_awarded := greatest(coalesce(new.awarded_xp, 0), 0);

  insert into public.app_events (
    type,
    actor_user_id,
    target_user_id,
    entity_type,
    entity_id,
    category,
    channel,
    priority,
    target_path,
    payload
  )
  values (
    'challenge.completed',
    new.user_id,
    new.user_id,
    'challenge',
    new.challenge_id,
    'challenge',
    'inbox',
    'normal',
    '/challenges',
    jsonb_build_object(
      'v', 1,
      'targetPath', '/challenges',
      'preview', jsonb_build_object(
        'title', 'Челлендж выполнен',
        'body', v_challenge_title
      ),
      'context', jsonb_build_object(
        'challengeId', new.challenge_id,
        'completedAt', new.completed_at,
        'xpAwarded', v_xp_awarded,
        'periodKey', new.period_key,
        'periodStart', new.period_start,
        'periodEnd', new.period_end
      )
    )
  );

  return new;
end;
$$;

revoke all on function public.create_challenge_completed_app_event() from public;
revoke all on function public.create_challenge_completed_app_event() from anon;
revoke all on function public.create_challenge_completed_app_event() from authenticated;

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
  v_period_is_eligible boolean := false;
  v_completed_at timestamptz;
  v_title text := 'Челлендж';
  v_xp_reward integer := 0;
  v_period_key text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_completion_inserted_count integer := 0;
  v_badge_inserted_count integer := 0;
begin
  select
    coalesce(nullif(trim(c.title), ''), 'Челлендж'),
    greatest(coalesce(c.xp_reward, 0)::integer, 0)
  into
    v_title,
    v_xp_reward
  from public.challenges c
  where c.id = p_challenge_id;

  if not found then
    raise exception 'Challenge % not found', p_challenge_id
      using errcode = 'P0002';
  end if;

  select
    rp.is_eligible,
    rp.period_key,
    rp.period_start,
    rp.period_end
  into
    v_period_is_eligible,
    v_period_key,
    v_period_start,
    v_period_end
  from public.challenges c
  cross join lateral public.resolve_challenge_period_window(
    c.period_type,
    c.starts_at,
    c.end_at,
    v_now
  ) rp
  where c.id = p_challenge_id;

  if not coalesce(v_period_is_eligible, false) then
    return jsonb_build_object(
      'completion_created', false,
      'badge_created', false,
      'completed_at', null
    );
  end if;

  if v_period_key is null then
    insert into public.user_challenges (
      user_id,
      challenge_id,
      completed_at,
      awarded_xp,
      title_snapshot,
      period_key,
      period_start,
      period_end
    )
    values (
      p_user_id,
      p_challenge_id,
      v_now,
      v_xp_reward,
      v_title,
      null,
      v_period_start,
      v_period_end
    )
    on conflict (user_id, challenge_id) where period_key is null do nothing;
  else
    insert into public.user_challenges (
      user_id,
      challenge_id,
      completed_at,
      awarded_xp,
      title_snapshot,
      period_key,
      period_start,
      period_end
    )
    values (
      p_user_id,
      p_challenge_id,
      v_now,
      v_xp_reward,
      v_title,
      v_period_key,
      v_period_start,
      v_period_end
    )
    on conflict (user_id, challenge_id, period_key) where period_key is not null do nothing;
  end if;

  get diagnostics v_completion_inserted_count = row_count;

  select uc.completed_at
  into v_completed_at
  from public.user_challenges uc
  where uc.user_id = p_user_id
    and uc.challenge_id = p_challenge_id
    and uc.period_key is not distinct from v_period_key
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
      'xp_awarded', v_xp_reward,
      'period_key', v_period_key,
      'period_start', v_period_start,
      'period_end', v_period_end
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
  with challenge_candidates as (
    select
      ch.id as challenge_id,
      coalesce(nullif(trim(ch.title), ''), 'Челлендж') as title_snapshot,
      greatest(coalesce(ch.xp_reward, 0)::integer, 0) as xp_awarded,
      ch.goal_unit,
      ch.goal_target,
      ch.period_type,
      rp.period_key,
      rp.period_start,
      rp.period_end
    from public.challenges ch
    cross join lateral public.resolve_challenge_period_window(
      ch.period_type,
      ch.starts_at,
      ch.end_at,
      v_now
    ) rp
    where rp.is_eligible
      and ch.goal_target is not null
      and ch.goal_target > 0
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
  ),
  challenge_progress as (
    select
      cc.challenge_id,
      cc.title_snapshot,
      cc.xp_awarded,
      cc.goal_unit,
      cc.goal_target,
      cc.period_key,
      cc.period_start,
      cc.period_end,
      coalesce(sum(coalesce(r.distance_km, 0)), 0)::numeric as total_distance_km,
      count(r.id)::integer as total_run_count
    from challenge_candidates cc
    left join public.runs r
      on r.user_id = p_user_id
      and (cc.period_start is null or r.created_at >= cc.period_start)
      and (cc.period_end is null or r.created_at < cc.period_end)
    group by
      cc.challenge_id,
      cc.title_snapshot,
      cc.xp_awarded,
      cc.goal_unit,
      cc.goal_target,
      cc.period_key,
      cc.period_start,
      cc.period_end
  ),
  eligible_challenges as (
    select
      cp.challenge_id,
      cp.title_snapshot,
      cp.xp_awarded,
      cp.period_key,
      cp.period_start,
      cp.period_end
    from challenge_progress cp
    where (
      cp.goal_unit = 'distance_km'::public.challenge_goal_unit
      and cp.total_distance_km >= cp.goal_target
    ) or (
      cp.goal_unit = 'run_count'::public.challenge_goal_unit
      and cp.total_run_count::numeric >= cp.goal_target
    )
  ),
  uncompleted_challenges as (
    select ec.*
    from eligible_challenges ec
    where not exists (
      select 1
      from public.user_challenges uc
      where uc.user_id = p_user_id
        and uc.challenge_id = ec.challenge_id
        and uc.period_key is not distinct from ec.period_key
    )
  ),
  inserted_non_periodic as (
    insert into public.user_challenges as uc (
      user_id,
      challenge_id,
      completed_at,
      awarded_xp,
      title_snapshot,
      period_key,
      period_start,
      period_end
    )
    select
      p_user_id,
      uc.challenge_id,
      v_now,
      uc.xp_awarded,
      uc.title_snapshot,
      null,
      uc.period_start,
      uc.period_end
    from uncompleted_challenges uc
    where uc.period_key is null
    on conflict (user_id, challenge_id) where period_key is null do nothing
    returning
      uc.challenge_id,
      uc.completed_at,
      uc.period_key
  ),
  inserted_periodic as (
    insert into public.user_challenges as uc (
      user_id,
      challenge_id,
      completed_at,
      awarded_xp,
      title_snapshot,
      period_key,
      period_start,
      period_end
    )
    select
      p_user_id,
      uc.challenge_id,
      v_now,
      uc.xp_awarded,
      uc.title_snapshot,
      uc.period_key,
      uc.period_start,
      uc.period_end
    from uncompleted_challenges uc
    where uc.period_key is not null
    on conflict (user_id, challenge_id, period_key) where period_key is not null do nothing
    returning
      uc.challenge_id,
      uc.completed_at,
      uc.period_key
  ),
  inserted_completions as (
    select
      inp.challenge_id,
      inp.completed_at,
      inp.period_key
    from inserted_non_periodic inp
    union all
    select
      ip.challenge_id,
      ip.completed_at,
      ip.period_key
    from inserted_periodic ip
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
        'challenge_id', uc.challenge_id,
        'title_snapshot', uc.title_snapshot,
        'xp_awarded', uc.xp_awarded,
        'period_key', uc.period_key,
        'period_start', uc.period_start,
        'period_end', uc.period_end
      )
    from inserted_completions ic
    join uncompleted_challenges uc
      on uc.challenge_id = ic.challenge_id
      and uc.period_key is not distinct from ic.period_key
    on conflict do nothing
    returning
      (meta ->> 'challenge_id')::uuid as badge_challenge_id,
      nullif(meta ->> 'period_key', '') as badge_period_key
  )
  select
    uc.challenge_id as out_challenge_id,
    uc.xp_awarded,
    ic.completed_at,
    ib.badge_challenge_id is not null as badge_created
  from inserted_completions ic
  join uncompleted_challenges uc
    on uc.challenge_id = ic.challenge_id
    and uc.period_key is not distinct from ic.period_key
  left join inserted_badges ib
    on ib.badge_challenge_id = ic.challenge_id
    and ib.badge_period_key is not distinct from ic.period_key
  order by ic.completed_at asc, uc.challenge_id asc;
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
after update of user_id, distance_km, created_at on public.runs
for each row
execute function public.finalize_earned_challenges_after_run_write();

revoke all on function public.finalize_earned_challenges_after_run_write() from public;
revoke all on function public.finalize_earned_challenges_after_run_write() from anon;
revoke all on function public.finalize_earned_challenges_after_run_write() from authenticated;

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
    select coalesce(sum(greatest(coalesce(uc.awarded_xp, 0), 0)), 0)::integer as total
    from public.user_challenges uc
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
    select coalesce(sum(greatest(coalesce(uc.awarded_xp, 0), 0)), 0)::integer as total
    from public.user_challenges uc
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
