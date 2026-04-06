alter table public.profiles
add column if not exists activity_inbox_last_read_at timestamptz null;
