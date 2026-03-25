drop policy if exists "Allow read reactions" on public.chat_message_reactions;

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

drop policy if exists "Allow own reactions" on public.chat_message_reactions;

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
      and public.can_access_chat_thread(m.thread_id)
  )
);
