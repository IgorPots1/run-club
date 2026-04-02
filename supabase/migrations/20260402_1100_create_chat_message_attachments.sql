create table if not exists public.chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  attachment_type text not null check (attachment_type in ('image')),
  storage_path text not null,
  public_url text not null,
  width integer null check (width is null or width > 0),
  height integer null check (height is null or height > 0),
  sort_order integer not null check (sort_order >= 0 and sort_order < 8),
  created_at timestamptz not null default now(),
  constraint chat_message_attachments_message_sort_unique unique (message_id, sort_order)
);

create index if not exists chat_message_attachments_message_id_idx
on public.chat_message_attachments (message_id);

create index if not exists chat_message_attachments_message_id_sort_order_idx
on public.chat_message_attachments (message_id, sort_order asc, created_at asc, id asc);

alter table public.chat_message_attachments enable row level security;

drop policy if exists "Authenticated users can read accessible chat attachments" on public.chat_message_attachments;
create policy "Authenticated users can read accessible chat attachments"
on public.chat_message_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.chat_messages m
    where m.id = chat_message_attachments.message_id
      and public.can_access_chat_thread(m.thread_id)
  )
);

drop policy if exists "Users can insert attachments into their own accessible chat messages" on public.chat_message_attachments;
create policy "Users can insert attachments into their own accessible chat messages"
on public.chat_message_attachments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.chat_messages m
    where m.id = chat_message_attachments.message_id
      and m.user_id = auth.uid()
      and public.can_access_chat_thread(m.thread_id)
  )
);

drop policy if exists "Users can update attachments on their own accessible chat messages" on public.chat_message_attachments;
create policy "Users can update attachments on their own accessible chat messages"
on public.chat_message_attachments
for update
to authenticated
using (
  exists (
    select 1
    from public.chat_messages m
    where m.id = chat_message_attachments.message_id
      and m.user_id = auth.uid()
      and public.can_access_chat_thread(m.thread_id)
  )
)
with check (
  exists (
    select 1
    from public.chat_messages m
    where m.id = chat_message_attachments.message_id
      and m.user_id = auth.uid()
      and public.can_access_chat_thread(m.thread_id)
  )
);

drop policy if exists "Users can delete attachments on their own accessible chat messages" on public.chat_message_attachments;
create policy "Users can delete attachments on their own accessible chat messages"
on public.chat_message_attachments
for delete
to authenticated
using (
  exists (
    select 1
    from public.chat_messages m
    where m.id = chat_message_attachments.message_id
      and m.user_id = auth.uid()
      and public.can_access_chat_thread(m.thread_id)
  )
);

drop policy if exists "Authenticated users can upload chat media" on storage.objects;
drop policy if exists "Authenticated users can upload own chat media" on storage.objects;
create policy "Authenticated users can upload own chat media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own chat media files" on storage.objects;
create policy "Users can delete own chat media files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.chat_message_attachments a
      join public.chat_messages m on m.id = a.message_id
      where a.storage_path = storage.objects.name
        and m.user_id = auth.uid()
    )
  )
);
