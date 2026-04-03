create table if not exists public.user_push_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  push_enabled boolean not null default true,
  chat_enabled boolean not null default true,
  chat_important_enabled boolean not null default true,
  run_like_enabled boolean not null default false,
  run_comment_enabled boolean not null default true,
  challenge_completed_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_push_preferences
add column if not exists push_enabled boolean;

alter table public.user_push_preferences
add column if not exists chat_enabled boolean;

alter table public.user_push_preferences
add column if not exists chat_important_enabled boolean;

alter table public.user_push_preferences
add column if not exists run_like_enabled boolean;

alter table public.user_push_preferences
add column if not exists run_comment_enabled boolean;

alter table public.user_push_preferences
add column if not exists challenge_completed_enabled boolean;

alter table public.user_push_preferences
add column if not exists created_at timestamptz;

alter table public.user_push_preferences
add column if not exists updated_at timestamptz;

alter table public.user_push_preferences
alter column push_enabled set default true;

alter table public.user_push_preferences
alter column chat_enabled set default true;

alter table public.user_push_preferences
alter column chat_important_enabled set default true;

alter table public.user_push_preferences
alter column run_like_enabled set default false;

alter table public.user_push_preferences
alter column run_comment_enabled set default true;

alter table public.user_push_preferences
alter column challenge_completed_enabled set default true;

alter table public.user_push_preferences
alter column created_at set default now();

alter table public.user_push_preferences
alter column updated_at set default now();

insert into public.user_push_preferences (user_id)
select users.id
from auth.users as users
on conflict (user_id) do nothing;

update public.user_push_preferences
set push_enabled = coalesce(push_enabled, true),
    chat_enabled = coalesce(chat_enabled, true),
    chat_important_enabled = coalesce(chat_important_enabled, true),
    run_like_enabled = coalesce(run_like_enabled, false),
    run_comment_enabled = coalesce(run_comment_enabled, true),
    challenge_completed_enabled = coalesce(challenge_completed_enabled, true),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now())
where push_enabled is null
   or chat_enabled is null
   or chat_important_enabled is null
   or run_like_enabled is null
   or run_comment_enabled is null
   or challenge_completed_enabled is null
   or created_at is null
   or updated_at is null;

alter table public.user_push_preferences
alter column push_enabled set not null;

alter table public.user_push_preferences
alter column chat_enabled set not null;

alter table public.user_push_preferences
alter column chat_important_enabled set not null;

alter table public.user_push_preferences
alter column run_like_enabled set not null;

alter table public.user_push_preferences
alter column run_comment_enabled set not null;

alter table public.user_push_preferences
alter column challenge_completed_enabled set not null;

alter table public.user_push_preferences
alter column created_at set not null;

alter table public.user_push_preferences
alter column updated_at set not null;

alter table public.user_push_preferences enable row level security;

drop policy if exists "Users can read their own push preferences" on public.user_push_preferences;
create policy "Users can read their own push preferences"
on public.user_push_preferences
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own push preferences" on public.user_push_preferences;
create policy "Users can insert their own push preferences"
on public.user_push_preferences
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own push preferences" on public.user_push_preferences;
create policy "Users can update their own push preferences"
on public.user_push_preferences
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_user_push_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_push_preferences_set_updated_at on public.user_push_preferences;

create trigger user_push_preferences_set_updated_at
before update on public.user_push_preferences
for each row
execute function public.set_user_push_preferences_updated_at();

alter table public.user_notification_settings
add column if not exists push_level text;

update public.user_notification_settings
set push_level = case
  when coalesce(muted, false) then 'mute'
  else 'all'
end
where push_level is null
   or push_level not in ('all', 'important_only', 'mute');

alter table public.user_notification_settings
alter column push_level set default 'all';

alter table public.user_notification_settings
alter column push_level set not null;

alter table public.user_notification_settings
drop constraint if exists user_notification_settings_push_level_check;

alter table public.user_notification_settings
add constraint user_notification_settings_push_level_check
check (push_level in ('all', 'important_only', 'mute'));

alter table public.chat_messages
add column if not exists push_priority text;

update public.chat_messages
set push_priority = 'normal'
where push_priority is null
   or push_priority not in ('normal', 'important');

alter table public.chat_messages
alter column push_priority set default 'normal';

alter table public.chat_messages
alter column push_priority set not null;

alter table public.chat_messages
drop constraint if exists chat_messages_push_priority_check;

alter table public.chat_messages
add constraint chat_messages_push_priority_check
check (push_priority in ('normal', 'important'));
