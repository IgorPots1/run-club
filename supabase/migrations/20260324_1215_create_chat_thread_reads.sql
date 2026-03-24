create table if not exists public.chat_thread_reads (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_message_id uuid null references public.chat_messages (id) on delete set null,
  last_read_at timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists chat_thread_reads_user_id_idx
on public.chat_thread_reads (user_id);

create index if not exists chat_thread_reads_thread_id_idx
on public.chat_thread_reads (thread_id);

create index if not exists chat_thread_reads_user_id_updated_at_idx
on public.chat_thread_reads (user_id, updated_at desc);

alter table public.chat_thread_reads enable row level security;

drop policy if exists "Users can read their own thread read state" on public.chat_thread_reads;
create policy "Users can read their own thread read state"
on public.chat_thread_reads
for select
to authenticated
using (
  auth.uid() = user_id
  and public.can_access_chat_thread(thread_id)
);

drop policy if exists "Users can create their own thread read state" on public.chat_thread_reads;
create policy "Users can create their own thread read state"
on public.chat_thread_reads
for insert
to authenticated
with check (
  auth.uid() = user_id
  and public.can_access_chat_thread(thread_id)
);

drop policy if exists "Users can update their own thread read state" on public.chat_thread_reads;
create policy "Users can update their own thread read state"
on public.chat_thread_reads
for update
to authenticated
using (
  auth.uid() = user_id
  and public.can_access_chat_thread(thread_id)
)
with check (
  auth.uid() = user_id
  and public.can_access_chat_thread(thread_id)
);
