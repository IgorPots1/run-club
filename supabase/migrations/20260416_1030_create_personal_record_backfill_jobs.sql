create table if not exists public.personal_record_backfill_jobs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null,
  next_page integer not null default 1,
  processed_activities_count integer not null default 0,
  scanned_pages_count integer not null default 0,
  candidates_found_count integer not null default 0,
  inserted_or_updated_count integer not null default 0,
  skipped_count integer not null default 0,
  last_error text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint personal_record_backfill_jobs_status_check check (
    status in ('pending', 'running', 'paused_rate_limited', 'completed', 'failed')
  ),
  constraint personal_record_backfill_jobs_next_page_positive_check check (next_page > 0),
  constraint personal_record_backfill_jobs_processed_activities_nonnegative_check check (
    processed_activities_count >= 0
  ),
  constraint personal_record_backfill_jobs_scanned_pages_nonnegative_check check (
    scanned_pages_count >= 0
  ),
  constraint personal_record_backfill_jobs_candidates_found_nonnegative_check check (
    candidates_found_count >= 0
  ),
  constraint personal_record_backfill_jobs_inserted_or_updated_nonnegative_check check (
    inserted_or_updated_count >= 0
  ),
  constraint personal_record_backfill_jobs_skipped_nonnegative_check check (skipped_count >= 0)
);

alter table public.personal_record_backfill_jobs enable row level security;

create or replace function public.set_personal_record_backfill_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists personal_record_backfill_jobs_set_updated_at
on public.personal_record_backfill_jobs;

create trigger personal_record_backfill_jobs_set_updated_at
before update on public.personal_record_backfill_jobs
for each row
execute function public.set_personal_record_backfill_jobs_updated_at();
