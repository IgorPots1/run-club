alter table public.run_comments
alter column run_id drop not null;

alter table public.run_comments
add column if not exists entity_type text;

alter table public.run_comments
add column if not exists entity_id uuid;

update public.run_comments
set entity_type = 'run'
where entity_type is null;

update public.run_comments
set entity_id = run_id
where entity_id is null and run_id is not null;

alter table public.run_comments
alter column entity_type set default 'run';

alter table public.run_comments
alter column entity_type set not null;

alter table public.run_comments
alter column entity_id set not null;

alter table public.run_comments
drop constraint if exists run_comments_entity_type_check;

alter table public.run_comments
add constraint run_comments_entity_type_check
check (entity_type in ('run', 'race'));

alter table public.run_comments
drop constraint if exists run_comments_entity_target_consistency_check;

alter table public.run_comments
add constraint run_comments_entity_target_consistency_check
check (
  (entity_type = 'run' and run_id is not null and run_id = entity_id)
  or (entity_type = 'race' and run_id is null)
);

create index if not exists run_comments_entity_type_entity_id_created_at_id_idx
on public.run_comments (entity_type, entity_id, created_at asc, id asc);

create index if not exists run_comments_entity_type_entity_id_parent_id_created_at_id_idx
on public.run_comments (entity_type, entity_id, parent_id, created_at asc, id asc);

drop policy if exists "Authenticated users can read comments on visible runs" on public.run_comments;
create policy "Authenticated users can read comments on visible entities"
on public.run_comments
for select
to authenticated
using (
  (
    run_comments.entity_type = 'run'
    and exists (
      select 1
      from public.runs
      where runs.id = run_comments.entity_id
    )
  )
  or (
    run_comments.entity_type = 'race'
    and exists (
      select 1
      from public.race_events
      where race_events.id = run_comments.entity_id
    )
  )
);

drop policy if exists "Users can create comments as themselves" on public.run_comments;
create policy "Users can create comments as themselves"
on public.run_comments
for insert
to authenticated
with check (
  auth.uid() = user_id
  and (
    (
      run_comments.entity_type = 'run'
      and run_comments.run_id is not null
      and run_comments.run_id = run_comments.entity_id
      and exists (
        select 1
        from public.runs
        where runs.id = run_comments.entity_id
      )
    )
    or (
      run_comments.entity_type = 'race'
      and run_comments.run_id is null
      and exists (
        select 1
        from public.race_events
        where race_events.id = run_comments.entity_id
      )
    )
  )
);

drop policy if exists "Users can update their own comments" on public.run_comments;
create policy "Users can update their own comments"
on public.run_comments
for update
to authenticated
using (
  auth.uid() = user_id
  and (
    (
      run_comments.entity_type = 'run'
      and exists (
        select 1
        from public.runs
        where runs.id = run_comments.entity_id
      )
    )
    or (
      run_comments.entity_type = 'race'
      and exists (
        select 1
        from public.race_events
        where race_events.id = run_comments.entity_id
      )
    )
  )
)
with check (
  auth.uid() = user_id
  and (
    (
      run_comments.entity_type = 'run'
      and exists (
        select 1
        from public.runs
        where runs.id = run_comments.entity_id
      )
    )
    or (
      run_comments.entity_type = 'race'
      and exists (
        select 1
        from public.race_events
        where race_events.id = run_comments.entity_id
      )
    )
  )
);

create or replace function public.prevent_run_comment_immutable_field_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'run_comments.user_id cannot be changed';
  end if;

  if new.run_id is distinct from old.run_id then
    raise exception 'run_comments.run_id cannot be changed';
  end if;

  if new.entity_type is distinct from old.entity_type then
    raise exception 'run_comments.entity_type cannot be changed';
  end if;

  if new.entity_id is distinct from old.entity_id then
    raise exception 'run_comments.entity_id cannot be changed';
  end if;

  if new.parent_id is distinct from old.parent_id then
    raise exception 'run_comments.parent_id cannot be changed';
  end if;

  return new;
end;
$$;

alter table public.run_comment_likes
alter column run_id drop not null;

alter table public.run_comment_likes
add column if not exists entity_type text;

alter table public.run_comment_likes
add column if not exists entity_id uuid;

update public.run_comment_likes l
set
  entity_type = coalesce(l.entity_type, c.entity_type, 'run'),
  entity_id = coalesce(l.entity_id, c.entity_id, l.run_id)
from public.run_comments c
where c.id = l.comment_id
  and (l.entity_type is null or l.entity_id is null);

alter table public.run_comment_likes
alter column entity_type set default 'run';

alter table public.run_comment_likes
alter column entity_type set not null;

alter table public.run_comment_likes
alter column entity_id set not null;

alter table public.run_comment_likes
drop constraint if exists run_comment_likes_entity_type_check;

alter table public.run_comment_likes
add constraint run_comment_likes_entity_type_check
check (entity_type in ('run', 'race'));

alter table public.run_comment_likes
drop constraint if exists run_comment_likes_entity_target_consistency_check;

alter table public.run_comment_likes
add constraint run_comment_likes_entity_target_consistency_check
check (
  (entity_type = 'run' and run_id is not null and run_id = entity_id)
  or (entity_type = 'race' and run_id is null)
);

drop policy if exists "Authenticated users can read run comment likes" on public.run_comment_likes;
create policy "Authenticated users can read run comment likes"
on public.run_comment_likes
for select
to authenticated
using (
  exists (
    select 1
    from public.run_comments
    where run_comments.id = run_comment_likes.comment_id
      and (
        (
          run_comments.entity_type = 'run'
          and exists (
            select 1
            from public.runs
            where runs.id = run_comments.entity_id
          )
        )
        or (
          run_comments.entity_type = 'race'
          and exists (
            select 1
            from public.race_events
            where race_events.id = run_comments.entity_id
          )
        )
      )
  )
);

create index if not exists run_comment_likes_entity_type_entity_id_created_at_idx
on public.run_comment_likes (entity_type, entity_id, created_at desc);

create or replace function public.get_entity_comments_with_meta(
  p_entity_type text,
  p_entity_id uuid,
  p_viewer_user_id uuid
)
returns table (
  id uuid,
  entity_type text,
  entity_id uuid,
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
    where c.entity_type = p_entity_type
      and c.entity_id = p_entity_id
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
    c.entity_type,
    c.entity_id,
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

revoke all on function public.get_entity_comments_with_meta(text, uuid, uuid) from public;
grant execute on function public.get_entity_comments_with_meta(text, uuid, uuid) to authenticated;

create or replace function public.get_run_comments_with_meta(
  p_run_id uuid,
  p_viewer_user_id uuid
)
returns table (
  id uuid,
  entity_type text,
  entity_id uuid,
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
  select *
  from public.get_entity_comments_with_meta('run', p_run_id, p_viewer_user_id);
$$;

revoke all on function public.get_run_comments_with_meta(uuid, uuid) from public;
grant execute on function public.get_run_comments_with_meta(uuid, uuid) to authenticated;
