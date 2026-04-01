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
  avatar_url text
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
    p.avatar_url
  from base_comments c
  left join public.profiles p
    on p.id = c.user_id
  left join replies_count rc
    on rc.parent_id = c.id
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
