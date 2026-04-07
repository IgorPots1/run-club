alter table public.runs
add column if not exists type text not null default 'training';

alter table public.runs
add column if not exists race_name text;

alter table public.runs
add column if not exists race_date date;

alter table public.runs
drop constraint if exists runs_type_check;

alter table public.runs
add constraint runs_type_check
check (type in ('training', 'race'));
