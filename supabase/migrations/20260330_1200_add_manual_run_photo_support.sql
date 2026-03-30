insert into storage.buckets (id, name, public)
select 'run-photos', 'run-photos', true
where not exists (
  select 1
  from storage.buckets
  where id = 'run-photos'
);

drop policy if exists "Public can view run photos" on storage.objects;
create policy "Public can view run photos"
on storage.objects
for select
to public
using (bucket_id = 'run-photos');

drop policy if exists "Authenticated users can upload own run photos" on storage.objects;
create policy "Authenticated users can upload own run photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'run-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

alter table public.run_photos
drop constraint if exists run_photos_source_check;

alter table public.run_photos
add constraint run_photos_source_check
check (source in ('strava', 'manual'));

drop policy if exists "Users can create manual photos on their own runs" on public.run_photos;
create policy "Users can create manual photos on their own runs"
on public.run_photos
for insert
to authenticated
with check (
  source = 'manual'
  and exists (
    select 1
    from public.runs
    where runs.id = run_photos.run_id
      and runs.user_id = auth.uid()
  )
);
