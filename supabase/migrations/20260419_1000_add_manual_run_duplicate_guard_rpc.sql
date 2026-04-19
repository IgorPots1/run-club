create or replace function public.create_manual_run_if_not_duplicate(
  p_user_id uuid,
  p_name text,
  p_title text,
  p_distance_km double precision,
  p_distance_meters integer,
  p_duration_minutes integer,
  p_duration_seconds integer,
  p_moving_time_seconds integer,
  p_elapsed_time_seconds integer,
  p_average_pace_seconds integer,
  p_created_at timestamptz,
  p_xp integer,
  p_xp_breakdown jsonb,
  p_shoe_id uuid,
  p_duplicate_window_seconds integer default 60
)
returns table (
  run_id uuid,
  was_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_run_id uuid;
  v_created_run_id uuid;
  v_duplicate_window interval := make_interval(secs => greatest(coalesce(p_duplicate_window_seconds, 0), 0));
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        p_user_id::text,
        to_char(p_created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        coalesce(p_distance_meters::text, ''),
        coalesce(p_duration_seconds::text, ''),
        coalesce(p_moving_time_seconds::text, '')
      ),
      0
    )
  );

  select r.id
  into v_existing_run_id
  from public.runs r
  where r.user_id = p_user_id
    and (
      r.external_source is null
      or btrim(r.external_source) = ''
      or btrim(r.external_source) = 'manual'
    )
    and r.created_at >= (p_created_at - v_duplicate_window)
    and r.created_at <= (p_created_at + v_duplicate_window)
    and r.distance_meters = p_distance_meters
    and r.duration_seconds = p_duration_seconds
    and coalesce(r.moving_time_seconds, 0) = coalesce(p_moving_time_seconds, 0)
  order by r.created_at desc, r.id desc
  limit 1;

  if v_existing_run_id is not null then
    return query
    select v_existing_run_id, false;
    return;
  end if;

  insert into public.runs (
    user_id,
    name,
    title,
    distance_km,
    distance_meters,
    duration_minutes,
    duration_seconds,
    moving_time_seconds,
    elapsed_time_seconds,
    average_pace_seconds,
    created_at,
    xp,
    xp_breakdown,
    shoe_id
  )
  values (
    p_user_id,
    p_name,
    p_title,
    p_distance_km,
    p_distance_meters,
    p_duration_minutes,
    p_duration_seconds,
    p_moving_time_seconds,
    p_elapsed_time_seconds,
    p_average_pace_seconds,
    p_created_at,
    p_xp,
    p_xp_breakdown,
    p_shoe_id
  )
  returning id
  into v_created_run_id;

  return query
  select v_created_run_id, true;
end;
$$;

revoke all on function public.create_manual_run_if_not_duplicate(
  uuid,
  text,
  text,
  double precision,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  timestamptz,
  integer,
  jsonb,
  uuid,
  integer
) from public;

revoke all on function public.create_manual_run_if_not_duplicate(
  uuid,
  text,
  text,
  double precision,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  timestamptz,
  integer,
  jsonb,
  uuid,
  integer
) from anon;

revoke all on function public.create_manual_run_if_not_duplicate(
  uuid,
  text,
  text,
  double precision,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  timestamptz,
  integer,
  jsonb,
  uuid,
  integer
) from authenticated;
