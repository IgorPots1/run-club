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
