create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index if not exists push_subscriptions_user_id_idx
on public.push_subscriptions (user_id);

create index if not exists push_subscriptions_created_at_idx
on public.push_subscriptions (created_at desc);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can insert their own push subscriptions" on public.push_subscriptions;
create policy "Users can insert their own push subscriptions"
on public.push_subscriptions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can read their own push subscriptions" on public.push_subscriptions;
create policy "Users can read their own push subscriptions"
on public.push_subscriptions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can delete their own push subscriptions" on public.push_subscriptions;
create policy "Users can delete their own push subscriptions"
on public.push_subscriptions
for delete
to authenticated
using (auth.uid() = user_id);
