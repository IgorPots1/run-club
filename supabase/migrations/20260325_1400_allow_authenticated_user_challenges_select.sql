drop policy if exists "Users can read their challenge completions" on public.user_challenges;
create policy "Users can read their challenge completions"
on public.user_challenges
for select
to authenticated
using (true);
