create or replace function public.get_race_week_timezone()
returns text
language sql
stable
as $$
  select 'Europe/Moscow'::text;
$$;

alter table public.race_weeks
drop constraint if exists race_weeks_status_check;

alter table public.race_weeks
add constraint race_weeks_status_check
check (status in ('scheduled', 'active', 'finalized'));

alter table public.race_weeks
alter column status set default 'scheduled';

drop index if exists public.race_weeks_active_status_unique_idx;
drop index if exists public.race_weeks_starts_at_unique_idx;

alter table public.race_weeks
drop constraint if exists race_weeks_no_overlapping_windows_excl;

do $$
declare
  v_now timestamptz := now();
  v_race_week_timezone text := public.get_race_week_timezone();
begin
  perform pg_advisory_xact_lock(942316, 8042025);

  create temporary table _race_week_repair_context
  on commit drop
  as
  select
    v_now as now_at,
    v_race_week_timezone as race_week_timezone,
    (date_trunc('week', v_now at time zone v_race_week_timezone) at time zone v_race_week_timezone) as current_starts_at,
    ((date_trunc('week', v_now at time zone v_race_week_timezone) at time zone v_race_week_timezone) + interval '7 days') as current_ends_at,
    ((date_trunc('week', v_now at time zone v_race_week_timezone) at time zone v_race_week_timezone) + interval '7 days') as next_starts_at,
    ((date_trunc('week', v_now at time zone v_race_week_timezone) at time zone v_race_week_timezone) + interval '14 days') as next_ends_at,
    to_char(
      (date_trunc('week', v_now at time zone v_race_week_timezone)),
      'YYYY-MM-DD'
    ) as current_slug,
    to_char(
      (date_trunc('week', v_now at time zone v_race_week_timezone) + interval '7 days'),
      'YYYY-MM-DD'
    ) as next_slug;

  create temporary table _race_week_repair_candidates
  on commit drop
  as
  with dependency_counts as (
    select
      rw.id,
      coalesce(rwr.results_count, 0)::integer as results_count,
      coalesce(uba.badges_count, 0)::integer as badges_count
    from public.race_weeks rw
    left join (
      select
        race_week_id,
        count(*)::integer as results_count
      from public.race_week_results
      group by race_week_id
    ) rwr
      on rwr.race_week_id = rw.id
    left join (
      select
        race_week_id,
        count(*)::integer as badges_count
      from public.user_badge_awards
      where race_week_id is not null
      group by race_week_id
    ) uba
      on uba.race_week_id = rw.id
  ),
  canonicalized as (
    select
      rw.id,
      rw.slug,
      rw.starts_at,
      rw.ends_at,
      rw.timezone,
      rw.status,
      rw.finalized_at,
      rw.created_at,
      dc.results_count,
      dc.badges_count,
      (date_trunc('week', rw.starts_at at time zone ctx.race_week_timezone) at time zone ctx.race_week_timezone) as canonical_starts_at,
      ((date_trunc('week', rw.starts_at at time zone ctx.race_week_timezone) at time zone ctx.race_week_timezone) + interval '7 days') as canonical_ends_at,
      to_char(
        (date_trunc('week', rw.starts_at at time zone ctx.race_week_timezone)),
        'YYYY-MM-DD'
      ) as canonical_slug,
      ctx.race_week_timezone as canonical_timezone,
      ctx.now_at
    from public.race_weeks rw
    cross join _race_week_repair_context ctx
    join dependency_counts dc
      on dc.id = rw.id
  )
  select
    c.*,
    (c.starts_at, c.ends_at, c.slug, c.timezone) is distinct from
    (c.canonical_starts_at, c.canonical_ends_at, c.canonical_slug, c.canonical_timezone) as needs_repair,
    row_number() over (
      partition by c.canonical_starts_at
      order by
        case
          when c.canonical_ends_at <= c.now_at and c.status = 'finalized' and c.results_count > 0 then 0
          when c.canonical_ends_at <= c.now_at and c.status = 'finalized' then 1
          when c.canonical_ends_at <= c.now_at and c.results_count > 0 then 2
          when c.canonical_ends_at <= c.now_at and c.badges_count > 0 then 3
          when c.canonical_ends_at <= c.now_at and c.status = 'active' then 4
          when c.canonical_ends_at <= c.now_at and c.status = 'scheduled' then 5

          when c.canonical_starts_at <= c.now_at and c.canonical_ends_at > c.now_at and c.status = 'active' and c.results_count = 0 then 10
          when c.canonical_starts_at <= c.now_at and c.canonical_ends_at > c.now_at and c.status = 'scheduled' and c.results_count = 0 then 11
          when c.canonical_starts_at <= c.now_at and c.canonical_ends_at > c.now_at and c.status <> 'finalized' and c.results_count = 0 then 12
          when c.canonical_starts_at <= c.now_at and c.canonical_ends_at > c.now_at and c.status = 'finalized' and c.results_count > 0 then 13
          when c.canonical_starts_at <= c.now_at and c.canonical_ends_at > c.now_at and c.status = 'finalized' then 14

          when c.canonical_starts_at > c.now_at and c.status = 'scheduled' and c.results_count = 0 then 20
          when c.canonical_starts_at > c.now_at and c.status = 'active' and c.results_count = 0 then 21
          when c.canonical_starts_at > c.now_at and c.status <> 'finalized' and c.results_count = 0 then 22
          when c.canonical_starts_at > c.now_at and c.status = 'finalized' then 23

          when c.results_count > 0 then 30
          when c.badges_count > 0 then 31
          when c.status = 'finalized' then 32
          when c.status = 'active' then 33
          when c.status = 'scheduled' then 34
          else 35
        end,
        c.finalized_at desc nulls last,
        c.created_at asc,
        c.id asc
    ) as winner_rank
  from canonicalized c;

  create temporary table _race_week_repair_winners
  on commit drop
  as
  select
    c.id as winner_id,
    c.canonical_starts_at,
    c.canonical_ends_at,
    c.canonical_slug,
    c.canonical_timezone,
    c.status as winner_status,
    c.finalized_at as winner_finalized_at,
    c.results_count as winner_results_count
  from _race_week_repair_candidates c
  where c.winner_rank = 1;

  create temporary table _race_week_repair_losers
  on commit drop
  as
  select
    loser.id as loser_id,
    winner.winner_id,
    loser.canonical_starts_at,
    loser.status as loser_status,
    loser.finalized_at as loser_finalized_at,
    loser.results_count as loser_results_count,
    loser.badges_count as loser_badges_count
  from _race_week_repair_candidates loser
  join _race_week_repair_winners winner
    on winner.canonical_starts_at = loser.canonical_starts_at
  where loser.winner_rank > 1;

  if exists (
    select 1
    from _race_week_repair_winners w
    cross join _race_week_repair_context ctx
    where w.canonical_ends_at > ctx.now_at
      and (w.winner_status = 'finalized' or w.winner_finalized_at is not null or w.winner_results_count > 0)
  ) then
    raise exception 'Legacy repair found finalized or snapshotted current/future race weeks; manual intervention required before automatic repair can continue'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from _race_week_repair_losers losers
    where losers.loser_results_count > 0
  ) then
    raise exception 'Legacy repair found duplicate canonical weeks with snapshot rows on non-winning records; manual merge required before automatic repair can continue'
      using errcode = 'P0001';
  end if;

  insert into public.user_badge_awards (
    user_id,
    badge_code,
    race_week_id,
    source_type,
    source_rank,
    awarded_at,
    meta,
    created_at
  )
  select
    uba.user_id,
    uba.badge_code,
    losers.winner_id,
    uba.source_type,
    uba.source_rank,
    uba.awarded_at,
    uba.meta,
    uba.created_at
  from public.user_badge_awards uba
  join _race_week_repair_losers losers
    on losers.loser_id = uba.race_week_id
  on conflict (user_id, badge_code, race_week_id) do nothing;

  delete from public.user_badge_awards uba
  using _race_week_repair_losers losers
  where uba.race_week_id = losers.loser_id;

  delete from public.race_weeks rw
  using _race_week_repair_losers losers
  where rw.id = losers.loser_id;

  update public.race_weeks rw
  set
    starts_at = winners.canonical_starts_at,
    ends_at = winners.canonical_ends_at,
    slug = winners.canonical_slug,
    timezone = winners.canonical_timezone
  from _race_week_repair_winners winners
  where rw.id = winners.winner_id
    and (
      rw.starts_at,
      rw.ends_at,
      rw.slug,
      rw.timezone
    ) is distinct from (
      winners.canonical_starts_at,
      winners.canonical_ends_at,
      winners.canonical_slug,
      winners.canonical_timezone
    );

  insert into public.race_weeks (
    slug,
    starts_at,
    ends_at,
    timezone,
    status
  )
  select
    ctx.current_slug,
    ctx.current_starts_at,
    ctx.current_ends_at,
    ctx.race_week_timezone,
    'active'
  from _race_week_repair_context ctx
  where not exists (
    select 1
    from public.race_weeks rw
    where rw.starts_at = ctx.current_starts_at
  );

  insert into public.race_weeks (
    slug,
    starts_at,
    ends_at,
    timezone,
    status
  )
  select
    ctx.next_slug,
    ctx.next_starts_at,
    ctx.next_ends_at,
    ctx.race_week_timezone,
    'scheduled'
  from _race_week_repair_context ctx
  where not exists (
    select 1
    from public.race_weeks rw
    where rw.starts_at = ctx.next_starts_at
  );

  update public.race_weeks rw
  set
    status = case
      when rw.status = 'finalized' then 'finalized'
      when rw.starts_at = ctx.current_starts_at then 'active'
      else 'scheduled'
    end,
    finalized_at = case
      when rw.status = 'finalized' then rw.finalized_at
      else null
    end,
    slug = to_char(rw.starts_at at time zone ctx.race_week_timezone, 'YYYY-MM-DD'),
    timezone = ctx.race_week_timezone
  from _race_week_repair_context ctx
  where true;

  if exists (
    select 1
    from public.race_weeks rw
    group by rw.starts_at
    having count(*) > 1
  ) then
    raise exception 'Race week repair produced duplicate canonical starts_at values'
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
    raise exception 'Race week repair produced overlapping windows'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)::integer
    from public.race_weeks rw
    cross join _race_week_repair_context ctx
    where rw.status = 'active'
      and rw.starts_at = ctx.current_starts_at
  ) <> 1 then
    raise exception 'Race week repair expected exactly one active current week'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.race_weeks rw
    cross join _race_week_repair_context ctx
    where rw.status = 'active'
      and rw.starts_at <> ctx.current_starts_at
  ) then
    raise exception 'Race week repair left unexpected active weeks outside the current canonical week'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.race_weeks rw
    cross join _race_week_repair_context ctx
    where rw.starts_at = ctx.next_starts_at
      and rw.status = 'scheduled'
  ) then
    raise exception 'Race week repair expected the next canonical week to exist as scheduled'
      using errcode = 'P0001';
  end if;
end;
$$;
