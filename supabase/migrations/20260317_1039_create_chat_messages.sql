create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  is_deleted boolean not null default false
);

create index if not exists chat_messages_created_at_idx
on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;

drop policy if exists "Authenticated users can read all chat messages" on public.chat_messages;
create policy "Authenticated users can read all chat messages"
on public.chat_messages
for select
to authenticated
using (true);

drop policy if exists "Users can insert chat messages as themselves" on public.chat_messages;
create policy "Users can insert chat messages as themselves"
on public.chat_messages
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own chat messages" on public.chat_messages;
create policy "Users can update their own chat messages"
on public.chat_messages
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own chat messages" on public.chat_messages;
create policy "Users can delete their own chat messages"
on public.chat_messages
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_chat_messages_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chat_messages_set_updated_at on public.chat_messages;

create trigger chat_messages_set_updated_at
before update on public.chat_messages
for each row
execute function public.set_chat_messages_updated_at();
