-- Confirmed from the current codebase:
-- - public.profiles uses: id, email, name, avatar_url
-- - public.runs uses: id, user_id, title, distance_km, duration_minutes, xp, created_at
-- - public.run_likes uses: run_id, user_id, created_at
-- - public.user_challenges uses: user_id, challenge_id, completed_at, xp_awarded


-- =========================================================
-- 1. SAFE TO RUN NOW
-- =========================================================
-- These statements are strongly justified by the current app.
-- Run this section first after confirming the referenced columns exist.

-- 1.1) Add safe defaults used by the current app.
-- The app expects runs.created_at and runs.xp to always exist for sorting and XP calculations.
alter table public.runs
  alter column created_at set default timezone('utc', now());

alter table public.runs
  alter column xp set default 0;


-- 1.2) Add basic non-destructive checks for future writes.
-- NOT VALID avoids breaking existing rows immediately while still protecting new bad data.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'runs_distance_km_positive'
  ) then
    alter table public.runs
      add constraint runs_distance_km_positive
      check (distance_km > 0) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'runs_duration_minutes_positive'
  ) then
    alter table public.runs
      add constraint runs_duration_minutes_positive
      check (duration_minutes > 0) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'runs_xp_nonnegative'
  ) then
    alter table public.runs
      add constraint runs_xp_nonnegative
      check (xp >= 0) not valid;
  end if;
end $$;


-- 1.3) Add indexes for the queries the app runs most often.
-- These are justified by confirmed columns used in the app.
create index if not exists runs_user_id_created_at_idx
on public.runs (user_id, created_at desc);

create index if not exists runs_created_at_idx
on public.runs (created_at desc);

create index if not exists run_likes_created_at_idx
on public.run_likes (created_at desc);

create index if not exists user_challenges_completed_at_idx
on public.user_challenges (completed_at desc);


-- =========================================================
-- 2. MANUAL REVIEW FIRST
-- =========================================================
-- Review this section in Supabase before running any of it.
--
-- 2.1) Manual policy checks
-- Review these RLS expectations in Supabase before inviting beta users.
--
-- profiles
-- - authenticated users can select profile rows for feed and leaderboard display
-- - authenticated users can insert only their own row: auth.uid() = id
-- - authenticated users can update only their own row: auth.uid() = id
--
-- runs
-- - authenticated users can select runs across users for feed, dashboard, leaderboard, and activity
-- - authenticated users can insert only their own rows: auth.uid() = user_id
-- - authenticated users can delete only their own rows: auth.uid() = user_id
--
-- run_likes
-- - select is allowed so like counts can be loaded
-- - insert is restricted to auth.uid() = user_id
-- - delete is restricted to auth.uid() = user_id
-- - verify the table keeps one like per user per run
--
-- user_challenges
-- - users must be able to insert their own completion rows
-- - if weekly/global leaderboard should include challenge XP across users,
--   authenticated users need select access to relevant rows
-- - if you want user_challenges to stay private, leaderboard challenge XP must be moved off the client
--
-- challenges
-- - select is allowed for authenticated users

-- 2.2) Manual schema checks
-- - verify public.profiles.id matches auth.users.id and is unique or primary key
-- - verify public.profiles.email exists before running the profile trigger section
-- - verify public.runs.user_id references auth.users.id
-- - verify public.run_likes already has primary key (run_id, user_id)
-- - verify public.user_challenges already has primary key (user_id, challenge_id)


-- 2.3) Auto-create a profile row for each new auth user.
-- Manual verification required before running:
-- - public.profiles has columns id and email
-- - public.profiles.id is unique or primary key
-- - auth.users exists as expected in Supabase Auth
-- This section does NOT drop or replace an existing trigger.
-- If a different profile-creation trigger already exists, review it manually instead of changing it here.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'on_auth_user_created'
      and not t.tgisinternal
  ) then
    create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();
  end if;
end $$;

-- 2.4) Manual review item: do not guess missing foreign keys or uniqueness constraints.
-- These are justified by the app, but this file does not add them automatically because the live schema
-- may already have them under different names.
-- Review and add them separately only if they are actually missing:
-- - public.profiles.id -> auth.users.id
-- - public.runs.user_id -> auth.users.id
-- - unique or primary key on public.profiles.id
