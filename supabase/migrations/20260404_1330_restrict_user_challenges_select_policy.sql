alter table public.user_challenges enable row level security;

drop policy if exists "Users can read their challenge completions" on public.user_challenges;

create policy "Users can read their challenge completions"
on public.user_challenges
for select
to authenticated
using (auth.uid() = user_id);
