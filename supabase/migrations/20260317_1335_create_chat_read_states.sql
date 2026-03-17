create table if not exists public.chat_read_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_read_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table public.chat_read_states enable row level security;

drop policy if exists "Users can read their own chat read state" on public.chat_read_states;
create policy "Users can read their own chat read state"
on public.chat_read_states
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can create their own chat read state" on public.chat_read_states;
create policy "Users can create their own chat read state"
on public.chat_read_states
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own chat read state" on public.chat_read_states;
create policy "Users can update their own chat read state"
on public.chat_read_states
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
