alter table public.chat_threads
add column if not exists channel_key text null;

with existing_social_thread as (
  select id
  from public.chat_threads
  where type = 'club'
    and channel_key is null
  order by created_at asc, id asc
  limit 1
)
update public.chat_threads as thread
set channel_key = 'social',
    title = 'Общение'
from existing_social_thread
where thread.id = existing_social_thread.id;

insert into public.chat_threads (type, channel_key, title)
select channel.type, channel.channel_key, channel.title
from (
  values
    ('club', 'reports', 'Отчеты'),
    ('club', 'social', 'Общение'),
    ('club', 'important_info', 'Важная информация')
) as channel(type, channel_key, title)
where not exists (
  select 1
  from public.chat_threads existing_thread
  where existing_thread.type = channel.type
    and existing_thread.channel_key = channel.channel_key
);

drop index if exists chat_threads_club_channel_key_unique_idx;
create unique index chat_threads_club_channel_key_unique_idx
on public.chat_threads (channel_key)
where type = 'club';

alter table public.chat_threads
drop constraint if exists chat_threads_type_channel_key_check;

alter table public.chat_threads
add constraint chat_threads_type_channel_key_check
check (
  (type = 'club' and channel_key in ('reports', 'social', 'important_info'))
  or (type = 'direct_coach' and channel_key is null)
);

create or replace function public.get_default_club_chat_thread_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.chat_threads
  where type = 'club'
    and channel_key = 'social'
  order by created_at asc, id asc
  limit 1
$$;
