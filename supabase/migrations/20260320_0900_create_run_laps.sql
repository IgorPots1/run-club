create table if not exists public.run_laps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  strava_activity_id bigint null,
  lap_index integer not null,
  name text null,
  distance_meters double precision null,
  elapsed_time_seconds integer null,
  moving_time_seconds integer null,
  average_speed double precision null,
  max_speed double precision null,
  average_heartrate double precision null,
  max_heartrate double precision null,
  total_elevation_gain double precision null,
  start_date timestamptz null,
  start_index integer null,
  end_index integer null,
  pace_seconds_per_km double precision null,
  created_at timestamptz not null default now(),
  unique (run_id, lap_index)
);

create index if not exists run_laps_run_id_idx
on public.run_laps (run_id);

alter table public.run_laps enable row level security;

drop policy if exists "Authenticated users can read laps on visible runs" on public.run_laps;
create policy "Authenticated users can read laps on visible runs"
on public.run_laps
for select
to authenticated
using (
  exists (
    select 1
    from public.runs
    where runs.id = run_laps.run_id
  )
);
