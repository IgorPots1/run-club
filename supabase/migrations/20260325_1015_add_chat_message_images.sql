alter table public.chat_messages
add column if not exists image_url text null;

insert into storage.buckets (id, name, public)
select 'chat-media', 'chat-media', true
where not exists (
  select 1
  from storage.buckets
  where id = 'chat-media'
);

drop policy if exists "Public can view chat media" on storage.objects;
create policy "Public can view chat media"
on storage.objects
for select
to public
using (bucket_id = 'chat-media');

drop policy if exists "Authenticated users can upload chat media" on storage.objects;
create policy "Authenticated users can upload chat media"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'chat-media');
