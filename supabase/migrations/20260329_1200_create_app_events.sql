create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  actor_user_id uuid null references auth.users (id) on delete set null,
  target_user_id uuid null references auth.users (id) on delete set null,
  entity_type text null,
  entity_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_events_created_at_idx
on public.app_events (created_at desc);

create index if not exists app_events_target_user_id_created_at_idx
on public.app_events (target_user_id, created_at desc);

create index if not exists app_events_type_created_at_idx
on public.app_events (type, created_at desc);

create index if not exists app_events_actor_user_id_created_at_idx
on public.app_events (actor_user_id, created_at desc);

alter table public.app_events enable row level security;

drop policy if exists "Authenticated users can insert app events" on public.app_events;
create policy "Authenticated users can insert app events"
on public.app_events
for insert
to authenticated
with check (true);

drop policy if exists "Users can read events targeted to themselves" on public.app_events;
create policy "Users can read events targeted to themselves"
on public.app_events
for select
to authenticated
using (target_user_id = auth.uid());
