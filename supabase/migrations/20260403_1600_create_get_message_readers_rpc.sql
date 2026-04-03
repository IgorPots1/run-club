create or replace function public.get_message_readers(p_message_id uuid)
returns table (
  user_id uuid,
  name text,
  nickname text,
  avatar_url text,
  last_read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_message record;
begin
  if p_message_id is null then
    raise exception 'invalid_message_id';
  end if;

  select
    m.id,
    m.thread_id,
    m.user_id as author_user_id,
    m.created_at,
    m.is_deleted
  into v_message
  from public.chat_messages m
  where m.id = p_message_id;

  if not found or coalesce(v_message.is_deleted, false) then
    raise exception 'chat_message_not_found';
  end if;

  if v_message.thread_id is null then
    raise exception 'thread_not_found';
  end if;

  if not public.can_access_chat_thread(v_message.thread_id) then
    raise exception 'thread_access_denied';
  end if;

  return query
  select
    r.user_id,
    p.name,
    p.nickname,
    p.avatar_url,
    r.last_read_at
  from public.chat_thread_reads r
  left join public.profiles p
    on p.id = r.user_id
  where r.thread_id = v_message.thread_id
    and r.user_id <> v_message.author_user_id
    and (
      r.last_read_at > v_message.created_at
      or r.last_read_message_id = v_message.id
    )
  order by r.last_read_at desc nulls last, r.user_id asc;
end;
$$;

revoke all on function public.get_message_readers(uuid) from public;
grant execute on function public.get_message_readers(uuid) to authenticated;
