create table if not exists public.run_likes (
  run_id uuid not null references public.runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (run_id, user_id)
);

alter table public.run_likes enable row level security;

drop policy if exists "Run likes are viewable by everyone" on public.run_likes;
create policy "Run likes are viewable by everyone"
on public.run_likes
for select
to public
using (true);

drop policy if exists "Users can like runs as themselves" on public.run_likes;
create policy "Users can like runs as themselves"
on public.run_likes
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.runs r
    where r.id = run_id
      and r.user_id is distinct from auth.uid()
  )
);

drop policy if exists "Users can remove their own likes" on public.run_likes;
create policy "Users can remove their own likes"
on public.run_likes
for delete
to authenticated
using (auth.uid() = user_id);
