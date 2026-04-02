insert into storage.buckets (id, name, public)
select 'chat-voice', 'chat-voice', false
where not exists (
  select 1
  from storage.buckets
  where id = 'chat-voice'
);

update storage.buckets
set public = false
where id = 'chat-voice';

drop policy if exists "Authenticated users can read accessible chat voice" on storage.objects;
create policy "Authenticated users can read accessible chat voice"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-voice'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] = 'voice'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
    or exists (
      select 1
      from public.chat_messages m
      where m.media_url = storage.objects.name
        and m.message_type = 'voice'
        and public.can_access_chat_thread(m.thread_id)
    )
  )
);

drop policy if exists "Authenticated users can upload own chat voice" on storage.objects;
create policy "Authenticated users can upload own chat voice"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-voice'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] = 'voice'
      and (storage.foldername(name))[2] = auth.uid()::text
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
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] = 'voice'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
    or exists (
      select 1
      from public.chat_messages m
      where m.media_url = storage.objects.name
        and m.user_id = auth.uid()
    )
  )
);
