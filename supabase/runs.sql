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

create unique index if not exists runs_external_source_external_id_idx
on public.runs (external_source, external_id)
where external_source is not null and external_id is not null;
