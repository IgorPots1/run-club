create table if not exists public.race_weeks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  status text not null default 'active',
  finalized_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint race_weeks_status_check check (status in ('active', 'finalized')),
  constraint race_weeks_time_window_check check (ends_at > starts_at)
);

create table if not exists public.race_week_results (
  id uuid primary key default gen_random_uuid(),
  race_week_id uuid not null references public.race_weeks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rank integer not null,
  total_xp integer not null default 0,
  run_xp integer not null default 0,
  like_xp integer not null default 0,
  challenge_xp integer not null default 0,
  runs_count integer null,
  display_name_snapshot text not null,
  finalized_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint race_week_results_race_week_user_unique unique (race_week_id, user_id),
  constraint race_week_results_race_week_rank_unique unique (race_week_id, rank),
  constraint race_week_results_rank_check check (rank > 0),
  constraint race_week_results_total_xp_check check (total_xp >= 0),
  constraint race_week_results_run_xp_check check (run_xp >= 0),
  constraint race_week_results_like_xp_check check (like_xp >= 0),
  constraint race_week_results_challenge_xp_check check (challenge_xp >= 0)
);

create table if not exists public.user_badge_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_code text not null,
  race_week_id uuid null references public.race_weeks(id) on delete set null,
  source_type text not null default 'weekly_race',
  source_rank integer null,
  awarded_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_badge_awards_user_badge_week_unique unique (user_id, badge_code, race_week_id),
  constraint user_badge_awards_source_rank_check check (source_rank is null or source_rank > 0)
);

create index if not exists race_week_results_user_id_race_week_id_idx
on public.race_week_results (user_id, race_week_id);

create index if not exists race_week_results_race_week_id_rank_idx
on public.race_week_results (race_week_id, rank);

create index if not exists user_badge_awards_user_id_awarded_at_idx
on public.user_badge_awards (user_id, awarded_at desc);

create index if not exists user_badge_awards_race_week_id_idx
on public.user_badge_awards (race_week_id);

alter table public.race_weeks enable row level security;
alter table public.race_week_results enable row level security;
alter table public.user_badge_awards enable row level security;

drop policy if exists "Authenticated users can read race weeks" on public.race_weeks;
create policy "Authenticated users can read race weeks"
on public.race_weeks
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read race week results" on public.race_week_results;
create policy "Authenticated users can read race week results"
on public.race_week_results
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read user badge awards" on public.user_badge_awards;
create policy "Authenticated users can read user badge awards"
on public.user_badge_awards
for select
to authenticated
using (true);
