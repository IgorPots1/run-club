create table if not exists public.shoe_models (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  version text null,
  full_name text not null,
  image_url text null,
  category text null,
  is_popular boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists shoe_models_full_name_idx
on public.shoe_models (full_name);

create index if not exists shoe_models_is_popular_idx
on public.shoe_models (is_popular);

create table if not exists public.user_shoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  shoe_model_id uuid null references public.shoe_models (id) on delete set null,
  custom_name text null,
  nickname text null,
  current_distance_meters integer not null default 0,
  photo_url text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint user_shoes_current_distance_meters_check check (current_distance_meters >= 0)
);

create index if not exists user_shoes_user_id_created_at_idx
on public.user_shoes (user_id, created_at desc);

alter table public.runs
add column if not exists shoe_id uuid references public.user_shoes (id) on delete set null;

create index if not exists runs_shoe_id_idx
on public.runs (shoe_id);

alter table public.shoe_models enable row level security;
alter table public.user_shoes enable row level security;

drop policy if exists "Authenticated users can read shoe models" on public.shoe_models;
create policy "Authenticated users can read shoe models"
on public.shoe_models
for select
to authenticated
using (true);

drop policy if exists "Users can insert their own shoes" on public.user_shoes;
create policy "Users can insert their own shoes"
on public.user_shoes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can read their own shoes" on public.user_shoes;
create policy "Users can read their own shoes"
on public.user_shoes
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can update their own shoes" on public.user_shoes;
create policy "Users can update their own shoes"
on public.user_shoes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own shoes" on public.user_shoes;
create policy "Users can delete their own shoes"
on public.user_shoes
for delete
to authenticated
using (auth.uid() = user_id);

merge into public.shoe_models as target
using (
  values
    ('Nike', 'Pegasus', '40', 'Nike Pegasus 40', null, 'daily_trainer', true),
    ('Nike', 'Invincible', '3', 'Nike Invincible 3', null, 'max_cushion', true),
    ('Adidas', 'Boston', '12', 'Adidas Boston 12', null, 'tempo_trainer', true),
    ('Adidas', 'Adios Pro', '3', 'Adidas Adios Pro 3', null, 'race', true),
    ('Asics', 'Novablast', '4', 'Asics Novablast 4', null, 'daily_trainer', true),
    ('Asics', 'Superblast', '2', 'Asics Superblast 2', null, 'super_trainer', true),
    ('Hoka', 'Mach', '6', 'Hoka Mach 6', null, 'daily_trainer', true),
    ('Saucony', 'Endorphin Speed', '4', 'Saucony Endorphin Speed 4', null, 'tempo_trainer', true)
) as source (brand, model, version, full_name, image_url, category, is_popular)
on target.brand = source.brand
and target.model = source.model
and target.version is not distinct from source.version
when matched then
  update set
    full_name = source.full_name,
    image_url = source.image_url,
    category = source.category,
    is_popular = source.is_popular
when not matched then
  insert (
    brand,
    model,
    version,
    full_name,
    image_url,
    category,
    is_popular
  )
  values (
    source.brand,
    source.model,
    source.version,
    source.full_name,
    source.image_url,
    source.category,
    source.is_popular
  );
