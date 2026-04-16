create table if not exists public.personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  distance_meters integer not null,
  duration_seconds integer not null,
  pace_seconds_per_km double precision null,
  run_id uuid null references public.runs(id) on delete set null,
  strava_activity_id bigint null,
  record_date date null,
  source text not null default 'strava_best_effort',
  metadata jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_records_user_distance_unique unique (user_id, distance_meters),
  constraint personal_records_supported_distance_check check (distance_meters in (5000, 10000)),
  constraint personal_records_duration_positive_check check (duration_seconds > 0),
  constraint personal_records_pace_nonnegative_check check (
    pace_seconds_per_km is null or pace_seconds_per_km >= 0
  )
);

create index if not exists personal_records_user_id_idx
on public.personal_records (user_id);

create index if not exists personal_records_run_id_idx
on public.personal_records (run_id)
where run_id is not null;

create index if not exists personal_records_strava_activity_id_idx
on public.personal_records (strava_activity_id)
where strava_activity_id is not null;

alter table public.personal_records enable row level security;

create policy "Users can read their own personal records"
on public.personal_records
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_personal_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists personal_records_set_updated_at on public.personal_records;

create trigger personal_records_set_updated_at
before update on public.personal_records
for each row
execute function public.set_personal_records_updated_at();
