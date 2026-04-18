create or replace function public.recompute_personal_record_for_user_distance(
  p_user_id uuid,
  p_distance_meters integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_best_source public.personal_record_sources%rowtype;
begin
  if p_distance_meters not in (5000, 10000, 21097, 42195) then
    raise exception 'unsupported personal record distance: %', p_distance_meters;
  end if;

  select *
  into v_best_source
  from public.personal_record_sources
  where user_id = p_user_id
    and distance_meters = p_distance_meters
    and duration_seconds >= case p_distance_meters
      when 5000 then 720
      when 10000 then 1440
      when 21097 then 3000
      when 42195 then 6300
    end
  order by
    duration_seconds asc,
    case when run_id is not null then 0 else 1 end asc,
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
    v_best_source.user_id,
    v_best_source.distance_meters,
    v_best_source.duration_seconds,
    v_best_source.pace_seconds_per_km,
    v_best_source.run_id,
    v_best_source.strava_activity_id,
    v_best_source.record_date,
    v_best_source.source_type,
    v_best_source.metadata
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
