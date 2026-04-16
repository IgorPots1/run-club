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
language sql
set search_path = public
as $$
  with upserted as (
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
      p_source,
      p_metadata
    )
    on conflict (user_id, distance_meters) do update
    set
      duration_seconds = excluded.duration_seconds,
      pace_seconds_per_km = excluded.pace_seconds_per_km,
      run_id = excluded.run_id,
      strava_activity_id = excluded.strava_activity_id,
      record_date = excluded.record_date,
      source = excluded.source,
      metadata = excluded.metadata
    where excluded.duration_seconds < personal_records.duration_seconds
    returning 1
  )
  select exists(select 1 from upserted);
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
