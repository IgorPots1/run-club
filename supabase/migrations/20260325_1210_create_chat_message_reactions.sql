create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists chat_message_reactions_message_id_idx
on public.chat_message_reactions (message_id);

create index if not exists chat_message_reactions_user_id_idx
on public.chat_message_reactions (user_id);

alter table public.chat_message_reactions enable row level security;

drop policy if exists "Authenticated users can read chat reactions" on public.chat_message_reactions;
create policy "Authenticated users can read chat reactions"
on public.chat_message_reactions
for select
to authenticated
using (true);

drop policy if exists "Users can insert their own chat reactions" on public.chat_message_reactions;
create policy "Users can insert their own chat reactions"
on public.chat_message_reactions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own chat reactions" on public.chat_message_reactions;
create policy "Users can delete their own chat reactions"
on public.chat_message_reactions
for delete
to authenticated
using (auth.uid() = user_id);
