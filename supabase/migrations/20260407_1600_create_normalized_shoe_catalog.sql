create table if not exists public.shoe_brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  logo_url text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.shoe_models_catalog (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.shoe_brands(id) on delete cascade,
  slug text not null,
  name text not null,
  category text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (brand_id, slug)
);

create table if not exists public.shoe_versions (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.shoe_models_catalog(id) on delete cascade,
  version_name text not null,
  full_name text not null,
  image_url text null,
  release_year integer null,
  is_current boolean not null default false,
  is_searchable boolean not null default true,
  created_at timestamptz not null default now(),
  unique (model_id, version_name)
);

create index if not exists shoe_models_catalog_brand_id_name_idx
on public.shoe_models_catalog (brand_id, name);

create index if not exists shoe_versions_model_id_full_name_idx
on public.shoe_versions (model_id, full_name);

create index if not exists shoe_versions_is_searchable_idx
on public.shoe_versions (is_searchable)
where is_searchable = true;

alter table public.user_shoes
add column if not exists shoe_version_id uuid null references public.shoe_versions(id) on delete set null;

create index if not exists user_shoes_shoe_version_id_idx
on public.user_shoes (shoe_version_id);

alter table public.shoe_brands enable row level security;
alter table public.shoe_models_catalog enable row level security;
alter table public.shoe_versions enable row level security;

drop policy if exists "Authenticated users can read shoe brands" on public.shoe_brands;
create policy "Authenticated users can read shoe brands"
on public.shoe_brands
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read shoe catalog models" on public.shoe_models_catalog;
create policy "Authenticated users can read shoe catalog models"
on public.shoe_models_catalog
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read shoe versions" on public.shoe_versions;
create policy "Authenticated users can read shoe versions"
on public.shoe_versions
for select
to authenticated
using (true);

with source_models as (
  select
    trim(sm.brand) as brand_name,
    case
      when regexp_replace(
        regexp_replace(lower(trim(sm.brand)), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)',
        '',
        'g'
      ) = '' then 'brand'
      else regexp_replace(
        regexp_replace(lower(trim(sm.brand)), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)',
        '',
        'g'
      )
    end as brand_slug_base
  from public.shoe_models sm
  where trim(sm.brand) <> ''
),
brand_source as (
  select distinct
    source_models.brand_name,
    source_models.brand_slug_base
  from source_models
),
brand_rows as (
  select
    brand_source.brand_name,
    case
      when row_number() over (
        partition by brand_source.brand_slug_base
        order by brand_source.brand_name
      ) = 1 then brand_source.brand_slug_base
      else brand_source.brand_slug_base || '-' || row_number() over (
        partition by brand_source.brand_slug_base
        order by brand_source.brand_name
      )
    end as brand_slug
  from brand_source
)
insert into public.shoe_brands (
  slug,
  name
)
select
  brand_rows.brand_slug,
  brand_rows.brand_name
from brand_rows
on conflict (slug) do update
set name = excluded.name;

with source_models as (
  select distinct on (
    trim(sm.brand),
    trim(sm.model)
  )
    trim(sm.brand) as brand_name,
    trim(sm.model) as model_name,
    nullif(trim(sm.category), '') as category,
    case
      when regexp_replace(
        regexp_replace(lower(trim(sm.model)), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)',
        '',
        'g'
      ) = '' then 'model'
      else regexp_replace(
        regexp_replace(lower(trim(sm.model)), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)',
        '',
        'g'
      )
    end as model_slug_base
  from public.shoe_models sm
  where trim(sm.brand) <> ''
    and trim(sm.model) <> ''
  order by
    trim(sm.brand),
    trim(sm.model),
    sm.created_at desc,
    sm.id desc
),
model_rows as (
  select
    shoe_brands.id as brand_id,
    source_models.model_name,
    source_models.category,
    case
      when row_number() over (
        partition by shoe_brands.id, source_models.model_slug_base
        order by source_models.model_name
      ) = 1 then source_models.model_slug_base
      else source_models.model_slug_base || '-' || row_number() over (
        partition by shoe_brands.id, source_models.model_slug_base
        order by source_models.model_name
      )
    end as model_slug
  from source_models
  join public.shoe_brands
    on shoe_brands.name = source_models.brand_name
)
insert into public.shoe_models_catalog (
  brand_id,
  slug,
  name,
  category
)
select
  model_rows.brand_id,
  model_rows.model_slug,
  model_rows.model_name,
  model_rows.category
from model_rows
on conflict (brand_id, slug) do update
set
  name = excluded.name,
  category = excluded.category;

with source_models as (
  select distinct on (
    trim(sm.brand),
    trim(sm.model),
    coalesce(nullif(trim(sm.version), ''), '')
  )
    trim(sm.brand) as brand_name,
    trim(sm.model) as model_name,
    coalesce(nullif(trim(sm.version), ''), '') as version_name,
    coalesce(
      nullif(trim(sm.full_name), ''),
      concat_ws(' ', trim(sm.brand), trim(sm.model), nullif(trim(sm.version), ''))
    ) as full_name,
    nullif(trim(sm.image_url), '') as image_url
  from public.shoe_models sm
  where trim(sm.brand) <> ''
    and trim(sm.model) <> ''
  order by
    trim(sm.brand),
    trim(sm.model),
    coalesce(nullif(trim(sm.version), ''), ''),
    sm.created_at desc,
    sm.id desc
),
version_rows as (
  select
    shoe_models_catalog.id as model_id,
    source_models.version_name,
    source_models.full_name,
    source_models.image_url
  from source_models
  join public.shoe_brands
    on shoe_brands.name = source_models.brand_name
  join public.shoe_models_catalog
    on shoe_models_catalog.brand_id = shoe_brands.id
   and shoe_models_catalog.name = source_models.model_name
)
insert into public.shoe_versions (
  model_id,
  version_name,
  full_name,
  image_url,
  is_current,
  is_searchable
)
select
  version_rows.model_id,
  version_rows.version_name,
  version_rows.full_name,
  version_rows.image_url,
  true,
  true
from version_rows
on conflict (model_id, version_name) do update
set
  full_name = excluded.full_name,
  image_url = excluded.image_url,
  is_searchable = excluded.is_searchable;

with legacy_model_to_version as (
  select
    sm.id as legacy_shoe_model_id,
    shoe_versions.id as shoe_version_id
  from public.shoe_models sm
  join public.shoe_brands
    on shoe_brands.name = trim(sm.brand)
  join public.shoe_models_catalog
    on shoe_models_catalog.brand_id = shoe_brands.id
   and shoe_models_catalog.name = trim(sm.model)
  join public.shoe_versions
    on shoe_versions.model_id = shoe_models_catalog.id
   and shoe_versions.version_name = coalesce(nullif(trim(sm.version), ''), '')
)
update public.user_shoes
set shoe_version_id = legacy_model_to_version.shoe_version_id
from legacy_model_to_version
where user_shoes.shoe_model_id = legacy_model_to_version.legacy_shoe_model_id
  and user_shoes.shoe_version_id is distinct from legacy_model_to_version.shoe_version_id;
