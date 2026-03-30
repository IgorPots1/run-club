create table if not exists public.run_photos (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  source text not null,
  source_photo_id text not null,
  public_url text not null,
  thumbnail_url text null,
  sort_order integer not null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  constraint run_photos_run_source_photo_unique unique (run_id, source, source_photo_id)
);

create index if not exists run_photos_run_id_idx
on public.run_photos (run_id);

create index if not exists run_photos_run_id_sort_order_idx
on public.run_photos (run_id, sort_order asc, created_at asc, id asc);

alter table public.run_photos enable row level security;

drop policy if exists "Authenticated users can read photos on visible runs" on public.run_photos;
create policy "Authenticated users can read photos on visible runs"
on public.run_photos
for select
to authenticated
using (
  exists (
    select 1
    from public.runs
    where runs.id = run_photos.run_id
  )
);
