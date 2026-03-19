create table if not exists public.run_detail_series (
  run_id uuid primary key references public.runs (id) on delete cascade,
  pace_points jsonb null,
  heartrate_points jsonb null,
  source text not null default 'strava',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.run_detail_series enable row level security;

drop policy if exists "Authenticated users can read series on visible runs" on public.run_detail_series;
create policy "Authenticated users can read series on visible runs"
on public.run_detail_series
for select
to authenticated
using (
  exists (
    select 1
    from public.runs
    where runs.id = run_detail_series.run_id
  )
);

create or replace function public.set_run_detail_series_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists run_detail_series_set_updated_at on public.run_detail_series;

create trigger run_detail_series_set_updated_at
before update on public.run_detail_series
for each row
execute function public.set_run_detail_series_updated_at();
