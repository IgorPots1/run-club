create or replace function public.get_unread_counts_by_thread(p_user_id uuid)
returns table (
  thread_id uuid,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id as thread_id,
    count(m.id)::bigint as unread_count
  from public.chat_threads t
  left join public.chat_thread_reads ctr
    on ctr.thread_id = t.id
   and ctr.user_id = p_user_id
  left join public.chat_messages m
    on m.thread_id = t.id
   and m.is_deleted = false
   and m.user_id <> p_user_id
   and (
     ctr.last_read_at is null
     or m.created_at > ctr.last_read_at
   )
  where p_user_id = auth.uid()
    and public.can_access_chat_thread(t.id)
  group by t.id
  order by t.id asc;
$$;

revoke all on function public.get_unread_counts_by_thread(uuid) from public;
grant execute on function public.get_unread_counts_by_thread(uuid) to authenticated;
