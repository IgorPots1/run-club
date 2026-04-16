alter table public.personal_records
add column if not exists hydration_attempted_at timestamptz null,
add column if not exists hydration_failed_at timestamptz null,
add column if not exists hydration_error text null;
