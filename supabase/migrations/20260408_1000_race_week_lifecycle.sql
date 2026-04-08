alter table public.race_weeks
drop constraint if exists race_weeks_status_check;

alter table public.race_weeks
add constraint race_weeks_status_check
check (status in ('scheduled', 'active', 'finalized'));

alter table public.race_weeks
alter column status set default 'scheduled';

create or replace function public.get_race_week_timezone()
returns text
language sql
stable
as $$
  select 'Europe/Moscow'::text;
$$;

update public.race_weeks rw
set
  starts_at = canonical.starts_at,
  ends_at = canonical.ends_at,
  slug = canonical.slug,
  timezone = canonical.timezone
from (
  select
    source.id,
    (date_trunc('week', source.starts_at at time zone public.get_race_week_timezone())
      at time zone public.get_race_week_timezone()) as starts_at,
    ((date_trunc('week', source.starts_at at time zone public.get_race_week_timezone())
      at time zone public.get_race_week_timezone()) + interval '7 days') as ends_at,
    to_char(
      (date_trunc('week', source.starts_at at time zone public.get_race_week_timezone())
        at time zone public.get_race_week_timezone()) at time zone public.get_race_week_timezone(),
      'YYYY-MM-DD'
    ) as slug,
    public.get_race_week_timezone() as timezone
  from public.race_weeks source
) canonical
where rw.id = canonical.id
  and (
    rw.starts_at,
    rw.ends_at,
    rw.slug,
    rw.timezone
  ) is distinct from (
    canonical.starts_at,
    canonical.ends_at,
    canonical.slug,
    canonical.timezone
  );

create or replace function public.resolve_current_race_week(
  p_now timestamptz default now()
)
returns table (
  id uuid,
  slug text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  status text,
  finalized_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with in_window as (
    select
      rw.id,
      rw.slug,
      rw.starts_at,
      rw.ends_at,
      rw.timezone,
      rw.status,
      rw.finalized_at,
      row_number() over (
        order by
          case when rw.status = 'active' then 0 else 1 end,
          rw.starts_at desc,
          rw.created_at desc,
          rw.id asc
      ) as row_num
    from public.race_weeks rw
    where rw.starts_at <= p_now
      and rw.ends_at > p_now
  ),
  fallback_active as (
    select
      rw.id,
      rw.slug,
      rw.starts_at,
      rw.ends_at,
      rw.timezone,
      rw.status,
      rw.finalized_at,
      row_number() over (
        order by rw.starts_at desc, rw.created_at desc, rw.id asc
      ) as row_num
    from public.race_weeks rw
    where rw.status = 'active'
  )
  select
    iw.id,
    iw.slug,
    iw.starts_at,
    iw.ends_at,
    iw.timezone,
    iw.status,
    iw.finalized_at
  from in_window iw
  where iw.row_num = 1

  union all

  select
    fa.id,
    fa.slug,
    fa.starts_at,
    fa.ends_at,
    fa.timezone,
    fa.status,
    fa.finalized_at
  from fallback_active fa
  where fa.row_num = 1
    and not exists (select 1 from in_window)
  limit 1;
$$;

revoke all on function public.resolve_current_race_week(timestamptz) from public;
revoke all on function public.resolve_current_race_week(timestamptz) from anon;
revoke all on function public.resolve_current_race_week(timestamptz) from authenticated;

create or replace function public.reconcile_race_week_lifecycle(
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_race_week_timezone text := public.get_race_week_timezone();
  v_local_now timestamp without time zone;
  v_local_current_starts_at timestamp without time zone;
  v_current_starts_at timestamptz;
  v_current_ends_at timestamptz;
  v_next_starts_at timestamptz;
  v_next_ends_at timestamptz;
  v_current_slug text;
  v_next_slug text;
  v_current_week_id uuid;
  v_next_week_id uuid;
  v_week_to_finalize_id uuid;
  v_active_count integer;
begin
  perform pg_advisory_xact_lock(942316, 8042026);

  v_local_now := v_now at time zone v_race_week_timezone;
  v_local_current_starts_at := date_trunc('week', v_local_now);
  v_current_starts_at := v_local_current_starts_at at time zone v_race_week_timezone;
  v_current_ends_at := v_current_starts_at + interval '7 days';
  v_next_starts_at := v_current_ends_at;
  v_next_ends_at := v_next_starts_at + interval '7 days';
  v_current_slug := to_char(v_current_starts_at at time zone v_race_week_timezone, 'YYYY-MM-DD');
  v_next_slug := to_char(v_next_starts_at at time zone v_race_week_timezone, 'YYYY-MM-DD');

  for v_week_to_finalize_id in
    select rw.id
    from public.race_weeks rw
    where rw.ends_at <= v_now
      and rw.status <> 'finalized'
    order by rw.starts_at asc, rw.created_at asc, rw.id asc
  loop
    perform public.finalize_race_week(v_week_to_finalize_id);
  end loop;

  insert into public.race_weeks (
    slug,
    starts_at,
    ends_at,
    timezone,
    status
  )
  select
    v_current_slug,
    v_current_starts_at,
    v_current_ends_at,
    v_race_week_timezone,
    'scheduled'
  where not exists (
    select 1
    from public.race_weeks rw
    where rw.starts_at = v_current_starts_at
  );

  insert into public.race_weeks (
    slug,
    starts_at,
    ends_at,
    timezone,
    status
  )
  select
    v_next_slug,
    v_next_starts_at,
    v_next_ends_at,
    v_race_week_timezone,
    'scheduled'
  where not exists (
    select 1
    from public.race_weeks rw
    where rw.starts_at = v_next_starts_at
  );

  select rw.id
  into v_current_week_id
  from public.race_weeks rw
  where rw.starts_at = v_current_starts_at
  order by rw.created_at desc, rw.id asc
  limit 1;

  select rw.id
  into v_next_week_id
  from public.race_weeks rw
  where rw.starts_at = v_next_starts_at
  order by rw.created_at desc, rw.id asc
  limit 1;

  if v_current_week_id is null then
    raise exception 'Failed to resolve current race week for %', v_current_slug
      using errcode = 'P0001';
  end if;

  if v_next_week_id is null then
    raise exception 'Failed to resolve next race week for %', v_next_slug
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.race_weeks rw
    where rw.id = v_current_week_id
      and rw.status = 'finalized'
      and rw.ends_at > v_now
  ) then
    raise exception 'Current race week % is finalized before its end', v_current_slug
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.race_weeks rw
    where rw.id = v_next_week_id
      and rw.status = 'finalized'
  ) then
    raise exception 'Next race week % is unexpectedly finalized', v_next_slug
      using errcode = 'P0001';
  end if;

  update public.race_weeks
  set
    status = 'scheduled',
    finalized_at = null,
    timezone = v_race_week_timezone
  where status <> 'finalized'
    and id <> v_current_week_id;

  update public.race_weeks
  set
    status = 'active',
    finalized_at = null,
    slug = v_current_slug,
    timezone = v_race_week_timezone
  where id = v_current_week_id
    and status <> 'finalized';

  update public.race_weeks
  set
    slug = case
      when id = v_current_week_id then v_current_slug
      when id = v_next_week_id then v_next_slug
      else slug
    end,
    timezone = v_race_week_timezone
  where id in (v_current_week_id, v_next_week_id);

  if exists (
    select 1
    from public.race_weeks rw
    group by rw.starts_at
    having count(*) > 1
  ) then
    raise exception 'Duplicate race_weeks.starts_at values detected during lifecycle reconciliation'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.race_weeks left_week
    join public.race_weeks right_week
      on left_week.id < right_week.id
     and tstzrange(left_week.starts_at, left_week.ends_at, '[)')
         && tstzrange(right_week.starts_at, right_week.ends_at, '[)')
  ) then
    raise exception 'Overlapping race week windows detected during lifecycle reconciliation'
      using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_active_count
  from public.race_weeks rw
  where rw.status = 'active';

  if v_active_count <> 1 then
    raise exception 'Expected exactly one active race week, found %', v_active_count
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.reconcile_race_week_lifecycle(timestamptz) from public;
revoke all on function public.reconcile_race_week_lifecycle(timestamptz) from anon;
revoke all on function public.reconcile_race_week_lifecycle(timestamptz) from authenticated;

create or replace function public.get_current_race_week()
returns table (
  id uuid,
  slug text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  status text,
  finalized_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rw.id,
    rw.slug,
    rw.starts_at,
    rw.ends_at,
    rw.timezone,
    rw.status,
    rw.finalized_at
  from public.resolve_current_race_week() rw;
$$;

revoke all on function public.get_current_race_week() from public;
revoke all on function public.get_current_race_week() from anon;
grant execute on function public.get_current_race_week() to authenticated;

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
  challenge_xp as (
    select
      uc.user_id,
      coalesce(sum(ch.xp_reward), 0)::integer as challenge_xp
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    join current_week w
      on uc.completed_at >= w.starts_at
     and uc.completed_at < w.ends_at
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

select public.reconcile_race_week_lifecycle();

create unique index if not exists race_weeks_active_status_unique_idx
on public.race_weeks (status)
where status = 'active';

create unique index if not exists race_weeks_starts_at_unique_idx
on public.race_weeks (starts_at);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'race_weeks_no_overlapping_windows_excl'
      and conrelid = 'public.race_weeks'::regclass
  ) then
    alter table public.race_weeks
    add constraint race_weeks_no_overlapping_windows_excl
    exclude using gist (
      tstzrange(starts_at, ends_at, '[)') with &&
    );
  end if;
end;
$$;

create extension if not exists pg_cron;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'reconcile-race-week-lifecycle'
  ) then
    perform cron.unschedule('reconcile-race-week-lifecycle');
  end if;

  perform cron.schedule(
    'reconcile-race-week-lifecycle',
    '*/5 * * * *',
    'select public.reconcile_race_week_lifecycle();'
  );
end;
$$;
