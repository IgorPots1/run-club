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
  with current_user_context as (
    -- Keep p_user_id for RPC compatibility, but always derive counts from auth.uid().
    select auth.uid() as user_id
  )
  select
    t.id as thread_id,
    count(m.id)::bigint as unread_count
  from current_user_context cu
  join public.chat_threads t
    on true
  left join public.chat_thread_reads r
    on r.thread_id = t.id
   and r.user_id = cu.user_id
  left join public.chat_messages m
    on m.thread_id = t.id
   and m.is_deleted = false
   and m.user_id <> cu.user_id
   and (
     r.last_read_at is null
     or m.created_at > r.last_read_at
   )
  where cu.user_id is not null
    and public.can_access_chat_thread(t.id)
  group by t.id
  order by t.id asc;
$$;

revoke all on function public.get_unread_counts_by_thread(uuid) from public;
grant execute on function public.get_unread_counts_by_thread(uuid) to authenticated;
