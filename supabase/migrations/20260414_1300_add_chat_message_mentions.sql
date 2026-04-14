alter table public.chat_messages
add column if not exists mention_user_ids uuid[] null,
add column if not exists mention_spans jsonb null;

alter table public.chat_messages
drop constraint if exists chat_messages_mention_spans_is_array;

alter table public.chat_messages
add constraint chat_messages_mention_spans_is_array
check (
  mention_spans is null
  or jsonb_typeof(mention_spans) = 'array'
);
