create or replace function public.prevent_future_run_dates()
returns trigger
language plpgsql
as $$
begin
  if new.created_at::date > current_date then
    raise exception 'Нельзя добавить тренировку в будущем';
  end if;

  return new;
end;
$$;

drop trigger if exists runs_prevent_future_dates on public.runs;

create trigger runs_prevent_future_dates
before insert or update on public.runs
for each row
execute function public.prevent_future_run_dates();

alter table public.runs
add column if not exists external_source text;

alter table public.runs
add column if not exists external_id text;

alter table public.runs
add column if not exists description text;

alter table public.runs
add column if not exists name_manually_edited boolean not null default false;

alter table public.runs
add column if not exists description_manually_edited boolean not null default false;

alter table public.runs
add column if not exists duration_seconds integer;

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

create unique index if not exists runs_external_source_external_id_idx
on public.runs (external_source, external_id)
where external_source is not null and external_id is not null;

alter table public.runs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'runs'
      and policyname = 'Users can update their own runs'
  ) then
    create policy "Users can update their own runs"
    on public.runs
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;
end
$$;
