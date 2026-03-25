create or replace function public.get_unread_counts_by_thread(p_user_id uuid)
returns table (
  thread_id uuid,
  unread_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    t.id as thread_id,
    count(m.id)::bigint as unread_count
  from public.chat_threads t
  left join public.chat_thread_reads r
    on r.thread_id = t.id
   and r.user_id = p_user_id
  left join public.chat_messages m
    on m.thread_id = t.id
   and m.is_deleted = false
   and m.user_id <> p_user_id
   and (
     r.last_read_at is null
     or m.created_at > r.last_read_at
   )
  where public.can_access_chat_thread(t.id)
  group by t.id
$$;
