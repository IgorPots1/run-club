create table if not exists public.personal_record_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  distance_meters integer not null,
  duration_seconds integer not null,
  pace_seconds_per_km double precision null,
  run_id uuid null references public.runs(id) on delete cascade,
  strava_activity_id bigint null,
  record_date date null,
  source_type text not null,
  source_key text not null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_record_sources_supported_distance_check check (distance_meters in (5000, 10000)),
  constraint personal_record_sources_duration_positive_check check (duration_seconds > 0),
  constraint personal_record_sources_pace_nonnegative_check check (
    pace_seconds_per_km is null or pace_seconds_per_km >= 0
  ),
  constraint personal_record_sources_source_type_check check (
    source_type in ('local_full_run', 'strava_best_effort', 'historical_strava_best_effort')
  ),
  constraint personal_record_sources_source_key_present_check check (btrim(source_key) <> ''),
  constraint personal_record_sources_source_reference_check check (
    (source_type = 'local_full_run' and run_id is not null)
    or (source_type = 'strava_best_effort' and run_id is not null)
    or (source_type = 'historical_strava_best_effort' and run_id is null)
  ),
  constraint personal_record_sources_user_distance_source_key_unique unique (
    user_id,
    distance_meters,
    source_type,
    source_key
  )
);

create index if not exists personal_record_sources_user_id_idx
on public.personal_record_sources (user_id);

create index if not exists personal_record_sources_user_distance_best_idx
on public.personal_record_sources (
  user_id,
  distance_meters,
  duration_seconds,
  record_date,
  created_at,
  id
);

create index if not exists personal_record_sources_run_id_idx
on public.personal_record_sources (run_id)
where run_id is not null;

create index if not exists personal_record_sources_strava_activity_id_idx
on public.personal_record_sources (strava_activity_id)
where strava_activity_id is not null;

alter table public.personal_record_sources enable row level security;

create or replace function public.set_personal_record_sources_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists personal_record_sources_set_updated_at on public.personal_record_sources;

create trigger personal_record_sources_set_updated_at
before update on public.personal_record_sources
for each row
execute function public.set_personal_record_sources_updated_at();

create or replace function public.recompute_personal_record_for_user_distance(
  p_user_id uuid,
  p_distance_meters integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_best public.personal_record_sources%rowtype;
begin
  if p_distance_meters not in (5000, 10000) then
    raise exception 'unsupported personal record distance: %', p_distance_meters;
  end if;

  select *
  into v_best
  from public.personal_record_sources
  where user_id = p_user_id
    and distance_meters = p_distance_meters
  order by
    duration_seconds asc,
    record_date asc nulls last,
    created_at asc,
    id asc
  limit 1;

  if not found then
    delete from public.personal_records
    where user_id = p_user_id
      and distance_meters = p_distance_meters;

    return false;
  end if;

  insert into public.personal_records (
    user_id,
    distance_meters,
    duration_seconds,
    pace_seconds_per_km,
    run_id,
    strava_activity_id,
    record_date,
    source,
    metadata
  )
  values (
    v_best.user_id,
    v_best.distance_meters,
    v_best.duration_seconds,
    v_best.pace_seconds_per_km,
    v_best.run_id,
    v_best.strava_activity_id,
    v_best.record_date,
    v_best.source_type,
    v_best.metadata
  )
  on conflict (user_id, distance_meters) do update
  set
    duration_seconds = excluded.duration_seconds,
    pace_seconds_per_km = excluded.pace_seconds_per_km,
    run_id = excluded.run_id,
    strava_activity_id = excluded.strava_activity_id,
    record_date = excluded.record_date,
    source = excluded.source,
    metadata = excluded.metadata;

  return true;
end;
$$;

revoke all on function public.recompute_personal_record_for_user_distance(uuid, integer) from public;
grant execute on function public.recompute_personal_record_for_user_distance(uuid, integer) to service_role;

create or replace function public.upsert_personal_record_source(
  p_user_id uuid,
  p_distance_meters integer,
  p_duration_seconds integer,
  p_pace_seconds_per_km numeric,
  p_run_id uuid,
  p_strava_activity_id bigint,
  p_record_date timestamptz,
  p_source_type text,
  p_source_key text,
  p_metadata jsonb
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_rows_changed integer := 0;
begin
  insert into public.personal_record_sources (
    user_id,
    distance_meters,
    duration_seconds,
    pace_seconds_per_km,
    run_id,
    strava_activity_id,
    record_date,
    source_type,
    source_key,
    metadata
  )
  values (
    p_user_id,
    p_distance_meters,
    p_duration_seconds,
    p_pace_seconds_per_km,
    p_run_id,
    p_strava_activity_id,
    case
      when p_record_date is null then null
      else (p_record_date at time zone 'UTC')::date
    end,
    p_source_type,
    p_source_key,
    p_metadata
  )
  on conflict (user_id, distance_meters, source_type, source_key) do update
  set
    duration_seconds = excluded.duration_seconds,
    pace_seconds_per_km = excluded.pace_seconds_per_km,
    run_id = excluded.run_id,
    strava_activity_id = excluded.strava_activity_id,
    record_date = excluded.record_date,
    metadata = excluded.metadata
  where personal_record_sources.duration_seconds is distinct from excluded.duration_seconds
    or personal_record_sources.pace_seconds_per_km is distinct from excluded.pace_seconds_per_km
    or personal_record_sources.run_id is distinct from excluded.run_id
    or personal_record_sources.strava_activity_id is distinct from excluded.strava_activity_id
    or personal_record_sources.record_date is distinct from excluded.record_date
    or personal_record_sources.metadata is distinct from excluded.metadata;

  get diagnostics v_rows_changed = row_count;

  perform public.recompute_personal_record_for_user_distance(
    p_user_id,
    p_distance_meters
  );

  return v_rows_changed > 0;
end;
$$;

revoke all on function public.upsert_personal_record_source(
  uuid,
  integer,
  integer,
  numeric,
  uuid,
  bigint,
  timestamptz,
  text,
  text,
  jsonb
) from public;

grant execute on function public.upsert_personal_record_source(
  uuid,
  integer,
  integer,
  numeric,
  uuid,
  bigint,
  timestamptz,
  text,
  text,
  jsonb
) to service_role;

create or replace function public.upsert_personal_record_if_better(
  p_user_id uuid,
  p_distance_meters integer,
  p_duration_seconds integer,
  p_pace_seconds_per_km numeric,
  p_run_id uuid,
  p_strava_activity_id bigint,
  p_record_date timestamptz,
  p_source text,
  p_metadata jsonb
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_source_type text;
  v_source_key text;
begin
  v_source_type := btrim(coalesce(p_source, ''));

  if v_source_type = 'local_full_run' then
    if p_run_id is null then
      raise exception 'local_full_run personal record source requires run_id';
    end if;

    v_source_key := format('run:%s', p_run_id);
  elsif v_source_type = 'strava_best_effort' then
    if p_run_id is not null then
      v_source_key := format('run:%s:distance:%s', p_run_id, p_distance_meters);
    elsif p_strava_activity_id is not null then
      v_source_type := 'historical_strava_best_effort';
      v_source_key := format('strava_activity:%s:distance:%s', p_strava_activity_id, p_distance_meters);
    else
      raise exception 'strava_best_effort personal record source requires run_id or strava_activity_id';
    end if;
  elsif v_source_type = 'historical_strava_best_effort' then
    if p_run_id is not null then
      raise exception 'historical_strava_best_effort personal record source must not include run_id';
    end if;

    if p_strava_activity_id is not null then
      v_source_key := format('strava_activity:%s:distance:%s', p_strava_activity_id, p_distance_meters);
    else
      v_source_key := format('legacy:%s:%s:%s', p_user_id, p_distance_meters, p_duration_seconds);
    end if;
  else
    raise exception 'unsupported personal record source type: %', p_source;
  end if;

  return public.upsert_personal_record_source(
    p_user_id,
    p_distance_meters,
    p_duration_seconds,
    p_pace_seconds_per_km,
    p_run_id,
    p_strava_activity_id,
    p_record_date,
    v_source_type,
    v_source_key,
    p_metadata
  );
end;
$$;

revoke all on function public.upsert_personal_record_if_better(
  uuid,
  integer,
  integer,
  numeric,
  uuid,
  bigint,
  timestamptz,
  text,
  jsonb
) from public;

grant execute on function public.upsert_personal_record_if_better(
  uuid,
  integer,
  integer,
  numeric,
  uuid,
  bigint,
  timestamptz,
  text,
  jsonb
) to service_role;

with local_run_sources as (
  select
    runs.user_id,
    case
      when abs(runs.distance_meters - 5000) <= 25 then 5000
      when abs(runs.distance_meters - 10000) <= 25 then 10000
      else null
    end as distance_meters,
    runs.moving_time_seconds as duration_seconds,
    round(
      runs.moving_time_seconds::numeric
      / (
        case
          when abs(runs.distance_meters - 5000) <= 25 then 5
          when abs(runs.distance_meters - 10000) <= 25 then 10
          else null
        end
      )
    )::integer as pace_seconds_per_km,
    runs.id as run_id,
    null::bigint as strava_activity_id,
    (runs.created_at at time zone 'UTC')::date as record_date,
    'local_full_run'::text as source_type,
    format('run:%s', runs.id) as source_key,
    case
      when runs.external_source is null
        or btrim(runs.external_source) = ''
        or runs.external_source = 'manual'
      then null
      else jsonb_build_object('external_source', btrim(runs.external_source))
    end as metadata
  from public.runs
  where runs.user_id is not null
    and runs.distance_meters is not null
    and runs.moving_time_seconds is not null
    and runs.moving_time_seconds > 0
    and coalesce(runs.external_source, '') <> 'strava'
    and (
      abs(runs.distance_meters - 5000) <= 25
      or abs(runs.distance_meters - 10000) <= 25
    )
)
insert into public.personal_record_sources (
  user_id,
  distance_meters,
  duration_seconds,
  pace_seconds_per_km,
  run_id,
  strava_activity_id,
  record_date,
  source_type,
  source_key,
  metadata
)
select
  local_run_sources.user_id,
  local_run_sources.distance_meters,
  local_run_sources.duration_seconds,
  local_run_sources.pace_seconds_per_km,
  local_run_sources.run_id,
  local_run_sources.strava_activity_id,
  local_run_sources.record_date,
  local_run_sources.source_type,
  local_run_sources.source_key,
  local_run_sources.metadata
from local_run_sources
where local_run_sources.distance_meters is not null
on conflict (user_id, distance_meters, source_type, source_key) do update
set
  duration_seconds = excluded.duration_seconds,
  pace_seconds_per_km = excluded.pace_seconds_per_km,
  run_id = excluded.run_id,
  strava_activity_id = excluded.strava_activity_id,
  record_date = excluded.record_date,
  metadata = excluded.metadata;

with strava_best_effort_sources as (
  select
    runs.user_id,
    best_efforts.distance_meters,
    best_efforts.duration_seconds,
    round(best_efforts.duration_seconds::numeric / (best_efforts.distance_meters::numeric / 1000))::integer as pace_seconds_per_km,
    runs.id as run_id,
    best_efforts.strava_activity_id,
    best_efforts.record_date,
    'strava_best_effort'::text as source_type,
    format('run:%s:distance:%s', runs.id, best_efforts.distance_meters) as source_key,
    best_efforts.metadata
  from public.runs
  cross join lateral (
    with raw_efforts as (
      select
        effort,
        ordinality,
        case
          when (effort->>'distance') ~ '^[0-9]+(\.[0-9]+)?$'
            and round((effort->>'distance')::numeric)::integer in (5000, 10000)
          then round((effort->>'distance')::numeric)::integer
          else null
        end as distance_meters,
        coalesce(
          case
            when (effort->>'elapsed_time') ~ '^[0-9]+(\.[0-9]+)?$'
            then round((effort->>'elapsed_time')::numeric)::integer
            else null
          end,
          case
            when (effort->>'moving_time') ~ '^[0-9]+(\.[0-9]+)?$'
            then round((effort->>'moving_time')::numeric)::integer
            else null
          end
        ) as duration_seconds,
        coalesce(
          case
            when jsonb_typeof(effort->'activity') = 'object'
              and ((effort->'activity'->>'id') ~ '^[0-9]+$')
            then (effort->'activity'->>'id')::bigint
            else null
          end,
          case
            when (effort->>'activity_id') ~ '^[0-9]+$'
            then (effort->>'activity_id')::bigint
            else null
          end,
          case
            when (runs.raw_strava_payload->>'id') ~ '^[0-9]+$'
            then (runs.raw_strava_payload->>'id')::bigint
            else null
          end,
          case
            when coalesce(runs.external_id, '') ~ '^[0-9]+$'
            then runs.external_id::bigint
            else null
          end
        ) as strava_activity_id,
        coalesce(
          case
            when nullif(effort->>'start_date', '') is not null
            then ((effort->>'start_date')::timestamptz at time zone 'UTC')::date
            else null
          end,
          case
            when nullif(effort->>'start_date_local', '') is not null
            then ((effort->>'start_date_local')::timestamptz at time zone 'UTC')::date
            else null
          end,
          case
            when nullif(runs.raw_strava_payload->>'start_date', '') is not null
            then ((runs.raw_strava_payload->>'start_date')::timestamptz at time zone 'UTC')::date
            else null
          end,
          case
            when nullif(runs.raw_strava_payload->>'start_date_local', '') is not null
            then ((runs.raw_strava_payload->>'start_date_local')::timestamptz at time zone 'UTC')::date
            else null
          end,
          (runs.created_at at time zone 'UTC')::date
        ) as record_date,
        nullif(
          jsonb_strip_nulls(
            jsonb_build_object(
              'name', nullif(btrim(effort->>'name'), ''),
              'pr_rank', case
                when (effort->>'pr_rank') ~ '^[0-9]+$'
                then ((effort->>'pr_rank')::integer)
                else null
              end,
              'elapsed_time', case
                when (effort->>'elapsed_time') ~ '^[0-9]+(\.[0-9]+)?$'
                then round((effort->>'elapsed_time')::numeric)::integer
                else null
              end,
              'moving_time', case
                when (effort->>'moving_time') ~ '^[0-9]+(\.[0-9]+)?$'
                then round((effort->>'moving_time')::numeric)::integer
                else null
              end,
              'start_index', case
                when (effort->>'start_index') ~ '^[0-9]+$'
                then (effort->>'start_index')::integer
                else null
              end,
              'end_index', case
                when (effort->>'end_index') ~ '^[0-9]+$'
                then (effort->>'end_index')::integer
                else null
              end
            )
          ),
          '{}'::jsonb
        ) as metadata
      from jsonb_array_elements(coalesce(runs.raw_strava_payload->'best_efforts', '[]'::jsonb)) with ordinality as raw_efforts(effort, ordinality)
    ),
    ranked_efforts as (
      select
        raw_efforts.distance_meters,
        raw_efforts.duration_seconds,
        raw_efforts.strava_activity_id,
        raw_efforts.record_date,
        raw_efforts.metadata,
        row_number() over (
          partition by raw_efforts.distance_meters
          order by raw_efforts.duration_seconds asc, raw_efforts.ordinality asc
        ) as rank_in_distance
      from raw_efforts
      where raw_efforts.distance_meters is not null
        and raw_efforts.duration_seconds is not null
        and raw_efforts.duration_seconds > 0
    )
    select
      ranked_efforts.distance_meters,
      ranked_efforts.duration_seconds,
      ranked_efforts.strava_activity_id,
      ranked_efforts.record_date,
      ranked_efforts.metadata
    from ranked_efforts
    where ranked_efforts.rank_in_distance = 1
  ) as best_efforts
  where runs.user_id is not null
    and runs.raw_strava_payload is not null
)
insert into public.personal_record_sources (
  user_id,
  distance_meters,
  duration_seconds,
  pace_seconds_per_km,
  run_id,
  strava_activity_id,
  record_date,
  source_type,
  source_key,
  metadata
)
select
  strava_best_effort_sources.user_id,
  strava_best_effort_sources.distance_meters,
  strava_best_effort_sources.duration_seconds,
  strava_best_effort_sources.pace_seconds_per_km,
  strava_best_effort_sources.run_id,
  strava_best_effort_sources.strava_activity_id,
  strava_best_effort_sources.record_date,
  strava_best_effort_sources.source_type,
  strava_best_effort_sources.source_key,
  strava_best_effort_sources.metadata
from strava_best_effort_sources
on conflict (user_id, distance_meters, source_type, source_key) do update
set
  duration_seconds = excluded.duration_seconds,
  pace_seconds_per_km = excluded.pace_seconds_per_km,
  run_id = excluded.run_id,
  strava_activity_id = excluded.strava_activity_id,
  record_date = excluded.record_date,
  metadata = excluded.metadata;

with canonical_seed_sources as (
  select
    personal_records.user_id,
    personal_records.distance_meters,
    personal_records.duration_seconds,
    personal_records.pace_seconds_per_km,
    personal_records.run_id,
    personal_records.strava_activity_id,
    personal_records.record_date,
    case
      when personal_records.source = 'local_full_run' and personal_records.run_id is not null
      then 'local_full_run'
      when personal_records.run_id is not null
      then 'strava_best_effort'
      else 'historical_strava_best_effort'
    end as source_type,
    case
      when personal_records.source = 'local_full_run' and personal_records.run_id is not null
      then format('run:%s', personal_records.run_id)
      when personal_records.run_id is not null
      then format('run:%s:distance:%s', personal_records.run_id, personal_records.distance_meters)
      when personal_records.strava_activity_id is not null
      then format('strava_activity:%s:distance:%s', personal_records.strava_activity_id, personal_records.distance_meters)
      else format('legacy_personal_record:%s', personal_records.id)
    end as source_key,
    personal_records.metadata
  from public.personal_records
  where personal_records.distance_meters in (5000, 10000)
    and personal_records.duration_seconds > 0
)
insert into public.personal_record_sources (
  user_id,
  distance_meters,
  duration_seconds,
  pace_seconds_per_km,
  run_id,
  strava_activity_id,
  record_date,
  source_type,
  source_key,
  metadata
)
select
  canonical_seed_sources.user_id,
  canonical_seed_sources.distance_meters,
  canonical_seed_sources.duration_seconds,
  canonical_seed_sources.pace_seconds_per_km,
  canonical_seed_sources.run_id,
  canonical_seed_sources.strava_activity_id,
  canonical_seed_sources.record_date,
  canonical_seed_sources.source_type,
  canonical_seed_sources.source_key,
  canonical_seed_sources.metadata
from canonical_seed_sources
on conflict (user_id, distance_meters, source_type, source_key) do nothing;

do $$
declare
  personal_record_target record;
begin
  for personal_record_target in
    select distinct user_id, distance_meters
    from public.personal_record_sources
  loop
    perform public.recompute_personal_record_for_user_distance(
      personal_record_target.user_id,
      personal_record_target.distance_meters
    );
  end loop;
end;
$$;
