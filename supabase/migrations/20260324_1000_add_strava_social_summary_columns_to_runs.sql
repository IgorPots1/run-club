alter table public.runs
add column if not exists raw_strava_payload jsonb;

alter table public.runs
add column if not exists description text;

alter table public.runs
add column if not exists photo_count integer;

alter table public.runs
add column if not exists city text;

alter table public.runs
add column if not exists region text;

alter table public.runs
add column if not exists country text;

alter table public.runs
add column if not exists sport_type text;

alter table public.runs
add column if not exists achievement_count integer;

alter table public.runs
add column if not exists strava_synced_at timestamptz;
