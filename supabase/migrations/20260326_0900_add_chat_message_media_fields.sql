alter table public.chat_messages
add column if not exists message_type text,
add column if not exists media_url text null,
add column if not exists media_duration_seconds integer null;

update public.chat_messages
set message_type = 'text'
where message_type is null;

alter table public.chat_messages
alter column message_type set default 'text',
alter column message_type set not null;

alter table public.chat_messages
drop constraint if exists chat_messages_message_type_check;

alter table public.chat_messages
add constraint chat_messages_message_type_check
check (message_type in ('text', 'image', 'voice'));
