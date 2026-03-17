alter table public.runs
add column if not exists duration_seconds integer;
