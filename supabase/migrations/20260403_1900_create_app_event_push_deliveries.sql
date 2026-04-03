create table if not exists public.app_event_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  app_event_id uuid not null references public.app_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_endpoint text not null,
  status text not null,
  status_code integer null,
  error_body text null,
  attempted_at timestamptz not null default now()
);

alter table public.app_event_push_deliveries
add column if not exists app_event_id uuid references public.app_events (id) on delete cascade;

alter table public.app_event_push_deliveries
add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.app_event_push_deliveries
add column if not exists subscription_endpoint text;

alter table public.app_event_push_deliveries
add column if not exists status text;

alter table public.app_event_push_deliveries
add column if not exists status_code integer;

alter table public.app_event_push_deliveries
add column if not exists error_body text;

alter table public.app_event_push_deliveries
add column if not exists attempted_at timestamptz;

update public.app_event_push_deliveries
set attempted_at = coalesce(attempted_at, now()),
    status = coalesce(nullif(btrim(status), ''), 'failed'),
    subscription_endpoint = coalesce(nullif(btrim(subscription_endpoint), ''), '__legacy__')
where attempted_at is null
   or status is null
   or btrim(status) = ''
   or subscription_endpoint is null
   or btrim(subscription_endpoint) = '';

alter table public.app_event_push_deliveries
alter column attempted_at set default now();

alter table public.app_event_push_deliveries
alter column app_event_id set not null;

alter table public.app_event_push_deliveries
alter column user_id set not null;

alter table public.app_event_push_deliveries
alter column subscription_endpoint set not null;

alter table public.app_event_push_deliveries
alter column status set not null;

alter table public.app_event_push_deliveries
alter column attempted_at set not null;

alter table public.app_event_push_deliveries
drop constraint if exists app_event_push_deliveries_status_check;

alter table public.app_event_push_deliveries
add constraint app_event_push_deliveries_status_check
check (status in ('processing', 'sent', 'failed', 'skipped', 'expired'));

create index if not exists app_event_push_deliveries_app_event_id_idx
on public.app_event_push_deliveries (app_event_id);

create index if not exists app_event_push_deliveries_user_id_idx
on public.app_event_push_deliveries (user_id);

create index if not exists app_event_push_deliveries_attempted_at_idx
on public.app_event_push_deliveries (attempted_at desc);

create index if not exists app_event_push_deliveries_endpoint_idx
on public.app_event_push_deliveries (subscription_endpoint);

create index if not exists app_event_push_deliveries_app_event_endpoint_attempted_at_idx
on public.app_event_push_deliveries (app_event_id, subscription_endpoint, attempted_at desc);

create unique index if not exists app_event_push_deliveries_active_claim_idx
on public.app_event_push_deliveries (app_event_id, subscription_endpoint)
where status in ('processing', 'sent', 'skipped', 'expired');

alter table public.app_event_push_deliveries enable row level security;
