create or replace function public.get_run_comments_with_meta(run_id uuid, viewer_user_id uuid)
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
  select
    rc.id,
    rc.run_id,
    rc.user_id,
    rc.parent_id,
    rc.comment,
    rc.created_at,
    rc.edited_at,
    rc.deleted_at,
    coalesce(
      nullif(btrim(p.nickname), ''),
      nullif(btrim(p.name), ''),
      nullif(btrim(p.email), ''),
      'Бегун'
    ) as display_name,
    nullif(btrim(p.nickname), '') as nickname,
    p.avatar_url
  from public.run_comments rc
  left join public.profiles p
    on p.id = rc.user_id
  where rc.run_id = $1
    and (
      rc.deleted_at is null
      or (
        rc.parent_id is null
        and exists (
          select 1
          from public.run_comments replies
          where replies.parent_id = rc.id
            and replies.deleted_at is null
        )
      )
    )
  order by rc.created_at asc, rc.id asc;
$$;

revoke all on function public.get_run_comments_with_meta(uuid, uuid) from public;
grant execute on function public.get_run_comments_with_meta(uuid, uuid) to authenticated;
