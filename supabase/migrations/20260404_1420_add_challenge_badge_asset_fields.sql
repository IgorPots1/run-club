alter table public.challenges
add column if not exists badge_storage_path text;

alter table public.challenges
add column if not exists badge_url text;

insert into storage.buckets (id, name, public)
select 'challenge-badges', 'challenge-badges', true
where not exists (
  select 1
  from storage.buckets
  where id = 'challenge-badges'
);

update storage.buckets
set public = true
where id = 'challenge-badges';

drop policy if exists "Public can view challenge badges" on storage.objects;
create policy "Public can view challenge badges"
on storage.objects
for select
to public
using (bucket_id = 'challenge-badges');

drop policy if exists "Authenticated users can upload own challenge badges" on storage.objects;
create policy "Authenticated users can upload own challenge badges"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'challenge-badges'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Authenticated users can delete own challenge badges" on storage.objects;
create policy "Authenticated users can delete own challenge badges"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'challenge-badges'
  and (storage.foldername(name))[1] = auth.uid()::text
);
