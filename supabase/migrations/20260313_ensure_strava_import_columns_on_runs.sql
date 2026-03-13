alter table public.runs
add column if not exists external_source text;

alter table public.runs
add column if not exists external_id text;

alter table public.runs
add column if not exists distance_meters integer;

alter table public.runs
add column if not exists duration_seconds integer;

alter table public.runs
add column if not exists moving_time_seconds integer;

alter table public.runs
add column if not exists elapsed_time_seconds integer;

alter table public.runs
add column if not exists average_pace_seconds integer;

alter table public.runs
add column if not exists elevation_gain_meters integer;

alter table public.runs
add column if not exists average_heartrate integer;

alter table public.runs
add column if not exists max_heartrate integer;

alter table public.runs
add column if not exists map_polyline text;

alter table public.runs
add column if not exists calories integer;

alter table public.runs
add column if not exists average_cadence integer;
