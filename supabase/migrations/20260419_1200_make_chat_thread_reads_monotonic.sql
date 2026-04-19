create or replace function public.mark_chat_thread_as_read(
  p_thread_id uuid,
  p_last_read_message_id uuid default null,
  p_last_read_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'auth_required';
  end if;

  if p_thread_id is null then
    raise exception 'thread_id_required';
  end if;

  if not public.can_access_chat_thread(p_thread_id) then
    raise exception 'thread_access_denied';
  end if;

  insert into public.chat_thread_reads as reads (
    thread_id,
    user_id,
    last_read_message_id,
    last_read_at,
    updated_at
  )
  values (
    p_thread_id,
    v_user_id,
    p_last_read_message_id,
    p_last_read_at,
    now()
  )
  on conflict (thread_id, user_id) do update
  set
    last_read_at = case
      when reads.last_read_at is null then excluded.last_read_at
      else greatest(reads.last_read_at, excluded.last_read_at)
    end,
    last_read_message_id = case
      when reads.last_read_at is null then excluded.last_read_message_id
      when excluded.last_read_at > reads.last_read_at then excluded.last_read_message_id
      when excluded.last_read_at = reads.last_read_at then coalesce(
        reads.last_read_message_id,
        excluded.last_read_message_id
      )
      else reads.last_read_message_id
    end,
    updated_at = case
      when reads.last_read_at is null then now()
      when excluded.last_read_at > reads.last_read_at then now()
      else reads.updated_at
    end;
end;
$$;

revoke all on function public.mark_chat_thread_as_read(uuid, uuid, timestamptz) from public;
grant execute on function public.mark_chat_thread_as_read(uuid, uuid, timestamptz) to authenticated;
