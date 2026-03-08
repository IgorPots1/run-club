create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  goal_km int4,
  goal_runs int4,
  xp_reward int4 default 0,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.challenges enable row level security;

drop policy if exists "Challenges are viewable by everyone" on public.challenges;
create policy "Challenges are viewable by everyone"
on public.challenges
for select
to public
using (true);
