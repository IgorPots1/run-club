create table if not exists public.run_comment_likes (
  comment_id uuid not null references public.run_comments (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (comment_id, user_id)
);

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
using (true);

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

create or replace function public.get_run_comments_with_meta(
  p_run_id uuid,
  p_viewer_user_id uuid
)
returns table (
  id uuid,
  run_id uuid,
  user_id uuid,
  parent_id uuid,
  comment text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  display_name text,
  nickname text,
  avatar_url text,
  likes_count integer,
  liked_by_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with base_comments as (
    select c.*
    from public.run_comments c
    where c.run_id = p_run_id
  ),
  replies_count as (
    select parent_id, count(*) as replies_count
    from base_comments
    where parent_id is not null and deleted_at is null
    group by parent_id
  ),
  likes_summary as (
    select
      l.comment_id,
      count(*)::integer as likes_count,
      bool_or(case when p_viewer_user_id is not null then l.user_id = p_viewer_user_id else false end) as liked_by_me
    from public.run_comment_likes l
    join base_comments c
      on c.id = l.comment_id
    group by l.comment_id
  )
  select
    c.id,
    c.run_id,
    c.user_id,
    c.parent_id,
    c.comment,
    c.created_at,
    c.edited_at,
    c.deleted_at,
    p.name as display_name,
    p.nickname,
    p.avatar_url,
    coalesce(ls.likes_count, 0)::integer as likes_count,
    coalesce(ls.liked_by_me, false) as liked_by_me
  from base_comments c
  left join public.profiles p
    on p.id = c.user_id
  left join replies_count rc
    on rc.parent_id = c.id
  left join likes_summary ls
    on ls.comment_id = c.id
  where
    (
      c.deleted_at is null
      or (
        c.parent_id is null
        and coalesce(rc.replies_count, 0) > 0
      )
    )
  order by c.created_at asc, c.id asc;
$$;

revoke all on function public.get_run_comments_with_meta(uuid, uuid) from public;
grant execute on function public.get_run_comments_with_meta(uuid, uuid) to authenticated;
