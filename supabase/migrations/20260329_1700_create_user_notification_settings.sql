create table if not exists public.user_notification_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_notification_settings_user_id_thread_id_key unique (user_id, thread_id)
);

create index if not exists user_notification_settings_user_id_idx
on public.user_notification_settings (user_id);

create index if not exists user_notification_settings_thread_id_idx
on public.user_notification_settings (thread_id);

alter table public.user_notification_settings enable row level security;

drop policy if exists "Users can insert their own notification settings" on public.user_notification_settings;
create policy "Users can insert their own notification settings"
on public.user_notification_settings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can read their own notification settings" on public.user_notification_settings;
create policy "Users can read their own notification settings"
on public.user_notification_settings
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can update their own notification settings" on public.user_notification_settings;
create policy "Users can update their own notification settings"
on public.user_notification_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own notification settings" on public.user_notification_settings;
create policy "Users can delete their own notification settings"
on public.user_notification_settings
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_user_notification_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_notification_settings_set_updated_at on public.user_notification_settings;

create trigger user_notification_settings_set_updated_at
before update on public.user_notification_settings
for each row
execute function public.set_user_notification_settings_updated_at();
