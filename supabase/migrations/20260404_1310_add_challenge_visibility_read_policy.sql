alter table public.challenges enable row level security;

drop policy if exists "Challenges are viewable by everyone" on public.challenges;
drop policy if exists "Challenges are viewable by visibility" on public.challenges;

create policy "Challenges are viewable by visibility"
on public.challenges
for select
to public
using (
  visibility = 'public'
  or (
    visibility = 'restricted'
    and auth.uid() is not null
    and exists (
      select 1
      from public.challenge_access_users cau
      where cau.challenge_id = challenges.id
        and cau.user_id = auth.uid()
    )
  )
);
