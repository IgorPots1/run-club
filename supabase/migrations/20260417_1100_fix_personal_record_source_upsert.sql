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
  v_source_type text := btrim(coalesce(p_source_type, ''));
  v_source_key text := btrim(coalesce(p_source_key, ''));
  v_record_date date := case
    when p_record_date is null then null
    else (p_record_date at time zone 'UTC')::date
  end;
begin
  if v_source_type = '' then
    raise exception 'personal record source type is required';
  end if;

  if v_source_key = '' then
    raise exception 'personal record source key is required';
  end if;

  update public.personal_record_sources
  set
    distance_meters = p_distance_meters,
    duration_seconds = p_duration_seconds,
    pace_seconds_per_km = p_pace_seconds_per_km,
    run_id = p_run_id,
    strava_activity_id = p_strava_activity_id,
    record_date = v_record_date,
    source_type = v_source_type,
    source_key = v_source_key,
    metadata = p_metadata
  where user_id = p_user_id
    and source_key = v_source_key;

  get diagnostics v_rows_changed = row_count;

  if v_rows_changed = 0 then
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
      v_record_date,
      v_source_type,
      v_source_key,
      p_metadata
    )
    on conflict (user_id, distance_meters, source_type, source_key) do update
    set
      duration_seconds = excluded.duration_seconds,
      pace_seconds_per_km = excluded.pace_seconds_per_km,
      run_id = excluded.run_id,
      strava_activity_id = excluded.strava_activity_id,
      record_date = excluded.record_date,
      metadata = excluded.metadata;

    get diagnostics v_rows_changed = row_count;
  end if;

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
