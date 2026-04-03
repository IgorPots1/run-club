create or replace function public.can_post_chat_thread(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_threads t
    where t.id = p_thread_id
      and (
        (
          t.type = 'direct_coach'
          and p_user_id in (t.owner_user_id, t.coach_user_id)
        )
        or (
          t.type = 'club'
          and (
            t.channel_key is distinct from 'important_info'
            or p_user_id = '9c831c40-928d-4d0c-99f7-393b2b985290'::uuid
          )
        )
      )
  );
$$;

create or replace function public.can_manage_chat_message(p_message_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with message_context as (
    select
      m.id,
      m.user_id,
      m.thread_id,
      t.type,
      t.channel_key,
      t.owner_user_id,
      t.coach_user_id
    from public.chat_messages m
    join public.chat_threads t
      on t.id = m.thread_id
    where m.id = p_message_id
  )
  select exists (
    select 1
    from message_context m
    where (
      (
        m.type = 'club'
        and m.channel_key = 'important_info'
        and p_user_id = '9c831c40-928d-4d0c-99f7-393b2b985290'::uuid
      )
      or (
        m.type = 'club'
        and m.channel_key is distinct from 'important_info'
        and m.user_id = p_user_id
      )
      or (
        m.type = 'direct_coach'
        and m.user_id = p_user_id
        and p_user_id in (m.owner_user_id, m.coach_user_id)
      )
    )
  );
$$;

revoke all on function public.can_post_chat_thread(uuid, uuid) from public;
grant execute on function public.can_post_chat_thread(uuid, uuid) to authenticated;

revoke all on function public.can_manage_chat_message(uuid, uuid) from public;
grant execute on function public.can_manage_chat_message(uuid, uuid) to authenticated;

drop policy if exists "Users can insert chat messages into accessible threads" on public.chat_messages;
create policy "Users can insert chat messages into accessible threads"
on public.chat_messages
for insert
to authenticated
with check (
  auth.uid() = user_id
  and (
    thread_id is null
    or public.can_post_chat_thread(thread_id, auth.uid())
  )
);

drop policy if exists "Users can update their own accessible chat messages" on public.chat_messages;
create policy "Users can update their own accessible chat messages"
on public.chat_messages
for update
to authenticated
using (public.can_manage_chat_message(id, auth.uid()))
with check (public.can_manage_chat_message(id, auth.uid()));

drop policy if exists "Users can delete their own accessible chat messages" on public.chat_messages;
create policy "Users can delete their own accessible chat messages"
on public.chat_messages
for delete
to authenticated
using (public.can_manage_chat_message(id, auth.uid()));

drop policy if exists "Users can insert attachments into their own accessible chat messages" on public.chat_message_attachments;
create policy "Users can insert attachments into their own accessible chat messages"
on public.chat_message_attachments
for insert
to authenticated
with check (public.can_manage_chat_message(message_id, auth.uid()));

drop policy if exists "Users can update attachments on their own accessible chat messages" on public.chat_message_attachments;
create policy "Users can update attachments on their own accessible chat messages"
on public.chat_message_attachments
for update
to authenticated
using (public.can_manage_chat_message(message_id, auth.uid()))
with check (public.can_manage_chat_message(message_id, auth.uid()));

drop policy if exists "Users can delete attachments on their own accessible chat messages" on public.chat_message_attachments;
create policy "Users can delete attachments on their own accessible chat messages"
on public.chat_message_attachments
for delete
to authenticated
using (public.can_manage_chat_message(message_id, auth.uid()));

drop policy if exists "Authenticated users can read chat reactions" on public.chat_message_reactions;
drop policy if exists "Allow read reactions by thread access" on public.chat_message_reactions;
create policy "Allow read reactions by thread access"
on public.chat_message_reactions
for select
to authenticated
using (
  exists (
    select 1
    from public.chat_messages m
    where m.id = message_id
      and public.can_access_chat_thread(m.thread_id)
  )
);

drop policy if exists "Users can insert their own chat reactions" on public.chat_message_reactions;
drop policy if exists "Allow insert reactions by thread access" on public.chat_message_reactions;
create policy "Allow insert reactions by thread access"
on public.chat_message_reactions
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.chat_messages m
    where m.id = message_id
      and public.can_post_chat_thread(m.thread_id, auth.uid())
  )
);

drop policy if exists "Users can delete their own chat reactions" on public.chat_message_reactions;
create policy "Users can delete their own chat reactions"
on public.chat_message_reactions
for delete
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.chat_messages m
    where m.id = message_id
      and public.can_post_chat_thread(m.thread_id, auth.uid())
  )
);

drop policy if exists "Users can delete own chat media files" on storage.objects;
create policy "Users can delete own chat media files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-media'
  and (
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and not exists (
        select 1
        from public.chat_message_attachments a
        where a.storage_path = storage.objects.name
      )
    )
    or exists (
      select 1
      from public.chat_message_attachments a
      join public.chat_messages m
        on m.id = a.message_id
      where a.storage_path = storage.objects.name
        and public.can_manage_chat_message(m.id, auth.uid())
    )
  )
);

drop policy if exists "Users can delete own chat voice files" on storage.objects;
create policy "Users can delete own chat voice files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-voice'
  and (
    (
      (
        (storage.foldername(name))[1] = auth.uid()::text
        or (
          (storage.foldername(name))[1] = 'voice'
          and (storage.foldername(name))[2] = auth.uid()::text
        )
      )
      and not exists (
        select 1
        from public.chat_messages m
        where m.media_url = storage.objects.name
          and m.message_type = 'voice'
      )
    )
    or exists (
      select 1
      from public.chat_messages m
      where m.media_url = storage.objects.name
        and m.message_type = 'voice'
        and public.can_manage_chat_message(m.id, auth.uid())
    )
  )
);

create or replace function public.validate_chat_message_request(
  p_user_id uuid,
  p_thread_id uuid default null,
  p_reply_to_id uuid default null
)
returns table (
  thread_exists boolean,
  can_access boolean,
  safe_reply_to_id uuid,
  can_post boolean,
  thread_channel_key text
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
      t.channel_key,
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
           or t.owner_user_id = p_user_id
           or t.coach_user_id = p_user_id
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
    ) as safe_reply_to_id,
    case
      when p_thread_id is null then true
      else public.can_post_chat_thread(p_thread_id, p_user_id)
    end as can_post,
    (
      select t.channel_key
      from thread_context t
      limit 1
    ) as thread_channel_key;
$$;

revoke all on function public.validate_chat_message_request(uuid, uuid, uuid) from public;
grant execute on function public.validate_chat_message_request(uuid, uuid, uuid) to authenticated;
