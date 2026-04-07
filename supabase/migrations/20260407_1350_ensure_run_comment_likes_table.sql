create table if not exists public.run_comment_likes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.run_comments (id) on delete cascade,
  run_id uuid null references public.runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.run_comment_likes
add column if not exists id uuid;

alter table public.run_comment_likes
add column if not exists run_id uuid null references public.runs (id) on delete cascade;

update public.run_comment_likes
set id = gen_random_uuid()
where id is null;

alter table public.run_comment_likes
alter column id set default gen_random_uuid();

alter table public.run_comment_likes
alter column id set not null;

alter table public.run_comment_likes
drop constraint if exists run_comment_likes_pkey;

alter table public.run_comment_likes
add constraint run_comment_likes_pkey primary key (id);

alter table public.run_comment_likes
drop constraint if exists run_comment_likes_user_id_fkey;

alter table public.run_comment_likes
add constraint run_comment_likes_user_id_fkey
foreign key (user_id)
references public.profiles (id)
on delete cascade;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'run_comment_likes_comment_id_user_id_key'
      and conrelid = 'public.run_comment_likes'::regclass
  ) then
    alter table public.run_comment_likes
    add constraint run_comment_likes_comment_id_user_id_key unique (comment_id, user_id);
  end if;
end
$$;

create index if not exists run_comment_likes_comment_id_idx
on public.run_comment_likes (comment_id);

create index if not exists run_comment_likes_user_id_idx
on public.run_comment_likes (user_id);

create index if not exists run_comment_likes_run_id_created_at_idx
on public.run_comment_likes (run_id, created_at desc);

create index if not exists run_comment_likes_comment_id_created_at_idx
on public.run_comment_likes (comment_id, created_at desc);

alter table public.run_comment_likes enable row level security;
alter table public.run_comment_likes replica identity full;

drop policy if exists "Authenticated users can read run comment likes" on public.run_comment_likes;
create policy "Authenticated users can read run comment likes"
on public.run_comment_likes
for select
to authenticated
using (
  exists (
    select 1
    from public.run_comments
    join public.runs
      on runs.id = run_comments.run_id
    where run_comments.id = run_comment_likes.comment_id
  )
);

drop policy if exists "Users can create run comment likes as themselves" on public.run_comment_likes;
create policy "Users can create run comment likes as themselves"
on public.run_comment_likes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own run comment likes" on public.run_comment_likes;
create policy "Users can remove their own run comment likes"
on public.run_comment_likes
for delete
to authenticated
using (auth.uid() = user_id);
