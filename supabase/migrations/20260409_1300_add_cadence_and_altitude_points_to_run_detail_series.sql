alter table public.run_detail_series
add column if not exists cadence_points jsonb null;

alter table public.run_detail_series
add column if not exists altitude_points jsonb null;
