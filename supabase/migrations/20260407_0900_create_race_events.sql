create table if not exists public.race_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  race_date date not null,
  linked_run_id uuid references public.runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists race_events_user_id_idx on public.race_events (user_id);
create index if not exists race_events_race_date_idx on public.race_events (race_date);
create index if not exists race_events_linked_run_id_idx on public.race_events (linked_run_id);

alter table public.race_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'race_events'
      and policyname = 'Users can read their own race events'
  ) then
    create policy "Users can read their own race events"
    on public.race_events
    for select
    to authenticated
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'race_events'
      and policyname = 'Users can insert their own race events'
  ) then
    create policy "Users can insert their own race events"
    on public.race_events
    for insert
    to authenticated
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'race_events'
      and policyname = 'Users can update their own race events'
  ) then
    create policy "Users can update their own race events"
    on public.race_events
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'race_events'
      and policyname = 'Users can delete their own race events'
  ) then
    create policy "Users can delete their own race events"
    on public.race_events
    for delete
    to authenticated
    using (auth.uid() = user_id);
  end if;
end
$$;
