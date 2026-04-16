create table if not exists public.strava_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  strava_athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  last_synced_at timestamptz,
  rate_limited_until timestamptz,
  status text not null default 'connected',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists strava_connections_user_id_idx
on public.strava_connections (user_id);

create unique index if not exists strava_connections_athlete_id_idx
on public.strava_connections (strava_athlete_id);

alter table public.strava_connections enable row level security;

drop policy if exists "Users can insert their own strava connection" on public.strava_connections;
create policy "Users can insert their own strava connection"
on public.strava_connections
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own strava connection" on public.strava_connections;
create policy "Users can update their own strava connection"
on public.strava_connections
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own strava connection" on public.strava_connections;
create policy "Users can delete their own strava connection"
on public.strava_connections
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_strava_connections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists strava_connections_set_updated_at on public.strava_connections;

create trigger strava_connections_set_updated_at
before update on public.strava_connections
for each row
execute function public.set_strava_connections_updated_at();
