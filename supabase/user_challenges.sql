create table if not exists public.user_challenges (
  user_id uuid not null references auth.users (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  completed_at timestamptz not null default timezone('utc', now()),
  xp_awarded int4 not null default 0,
  primary key (user_id, challenge_id)
);

alter table public.user_challenges enable row level security;

drop policy if exists "Users can read their challenge completions" on public.user_challenges;
create policy "Users can read their challenge completions"
on public.user_challenges
for select
to authenticated
using (true);

drop policy if exists "Users can insert their challenge completions" on public.user_challenges;
create policy "Users can insert their challenge completions"
on public.user_challenges
for insert
to authenticated
with check (auth.uid() = user_id);
