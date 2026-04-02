create or replace function public.validate_chat_message_request(
  p_thread_id uuid default null,
  p_reply_to_id uuid default null
)
returns table (
  thread_exists boolean,
  can_access boolean,
  safe_reply_to_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with thread_context as (
    select
      t.id,
      t.type,
      t.owner_user_id,
      t.coach_user_id
    from public.chat_threads t
    where p_thread_id is not null
      and t.id = p_thread_id
  )
  select
    case
      when p_thread_id is null then true
      else exists(select 1 from thread_context)
    end as thread_exists,
    case
      when p_thread_id is null then true
      when exists(
        select 1
        from thread_context t
        where t.type = 'club'
           or t.owner_user_id = auth.uid()
           or t.coach_user_id = auth.uid()
      ) then true
      else false
    end as can_access,
    (
      select m.id
      from public.chat_messages m
      where p_reply_to_id is not null
        and m.id = p_reply_to_id
        and m.thread_id is not distinct from p_thread_id
      limit 1
    ) as safe_reply_to_id;
$$;

revoke all on function public.validate_chat_message_request(uuid, uuid) from public;
grant execute on function public.validate_chat_message_request(uuid, uuid) to authenticated;
