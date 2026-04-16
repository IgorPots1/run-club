alter table public.personal_records
drop constraint if exists personal_records_supported_distance_check;

alter table public.personal_records
add constraint personal_records_supported_distance_check
check (distance_meters in (5000, 10000, 21097, 42195));

alter table public.personal_record_sources
drop constraint if exists personal_record_sources_supported_distance_check;

alter table public.personal_record_sources
add constraint personal_record_sources_supported_distance_check
check (distance_meters in (5000, 10000, 21097, 42195));

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
  if p_distance_meters not in (5000, 10000, 21097, 42195) then
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

with local_run_sources as (
  select
    runs.user_id,
    case
      when abs(runs.distance_meters - 5000) <= 25 then 5000
      when abs(runs.distance_meters - 10000) <= 25 then 10000
      when abs(runs.distance_meters - 21097) <= 30 then 21097
      when abs(runs.distance_meters - 42195) <= 50 then 42195
      else null
    end as distance_meters,
    runs.moving_time_seconds as duration_seconds,
    round(
      runs.moving_time_seconds::numeric
      / (
        case
          when abs(runs.distance_meters - 5000) <= 25 then 5
          when abs(runs.distance_meters - 10000) <= 25 then 10
          when abs(runs.distance_meters - 21097) <= 30 then 21.097
          when abs(runs.distance_meters - 42195) <= 50 then 42.195
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
      or abs(runs.distance_meters - 21097) <= 30
      or abs(runs.distance_meters - 42195) <= 50
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
        regexp_replace(lower(coalesce(effort->>'name', '')), '[^a-z0-9]+', '', 'g') as normalized_name,
        case
          when (effort->>'distance') ~ '^[0-9]+(\.[0-9]+)?$'
            and round((effort->>'distance')::numeric)::integer in (5000, 10000, 21097, 42195)
          then round((effort->>'distance')::numeric)::integer
          when regexp_replace(lower(coalesce(effort->>'name', '')), '[^a-z0-9]+', '', 'g') in ('5k', '5km')
            or regexp_replace(lower(coalesce(effort->>'name', '')), '[^a-z0-9]+', '', 'g') like '%5000%'
          then 5000
          when regexp_replace(lower(coalesce(effort->>'name', '')), '[^a-z0-9]+', '', 'g') in ('10k', '10km')
            or regexp_replace(lower(coalesce(effort->>'name', '')), '[^a-z0-9]+', '', 'g') like '%10000%'
          then 10000
          when regexp_replace(lower(coalesce(effort->>'name', '')), '[^a-z0-9]+', '', 'g') in ('halfmarathon', '21k', '21km', '211km')
            or regexp_replace(lower(coalesce(effort->>'name', '')), '[^a-z0-9]+', '', 'g') like '%21097%'
          then 21097
          when regexp_replace(lower(coalesce(effort->>'name', '')), '[^a-z0-9]+', '', 'g') in ('marathon', '42k', '42km', '422km')
            or regexp_replace(lower(coalesce(effort->>'name', '')), '[^a-z0-9]+', '', 'g') like '%42195%'
          then 42195
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

do $$
declare
  personal_record_target record;
begin
  for personal_record_target in
    select distinct user_id, distance_meters
    from public.personal_record_sources
    where distance_meters in (5000, 10000, 21097, 42195)
  loop
    perform public.recompute_personal_record_for_user_distance(
      personal_record_target.user_id,
      personal_record_target.distance_meters
    );
  end loop;
end;
$$;
