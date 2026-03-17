alter table public.runs
add column if not exists distance_meters integer;

alter table public.runs
add column if not exists moving_time_seconds integer;

alter table public.runs
add column if not exists elapsed_time_seconds integer;

alter table public.runs
add column if not exists average_pace_seconds integer;

alter table public.runs
add column if not exists elevation_gain_meters integer;
