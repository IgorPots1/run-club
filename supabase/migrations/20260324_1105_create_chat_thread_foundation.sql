create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('club', 'direct_coach')),
  title text null,
  owner_user_id uuid null references auth.users (id) on delete cascade,
  coach_user_id uuid null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_thread_members (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('member', 'coach')),
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists chat_threads_type_idx
on public.chat_threads (type);

create index if not exists chat_thread_members_user_id_idx
on public.chat_thread_members (user_id);

alter table public.chat_messages
add column if not exists thread_id uuid references public.chat_threads (id) on delete cascade;

insert into public.chat_threads (type)
select 'club'
where not exists (
  select 1
  from public.chat_threads
  where type = 'club'
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
  order by created_at asc, id asc
  limit 1
$$;

update public.chat_messages
set thread_id = public.get_default_club_chat_thread_id()
where thread_id is null;

create index if not exists chat_messages_thread_id_created_at_idx
on public.chat_messages (thread_id, created_at);

create or replace function public.is_chat_thread_member(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_thread_members
    where thread_id = p_thread_id
      and user_id = auth.uid()
  )
$$;

create or replace function public.can_access_chat_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_threads
    where id = p_thread_id
      and (
        type = 'club'
        or public.is_chat_thread_member(p_thread_id)
      )
  )
$$;

create or replace function public.set_default_chat_message_thread_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.thread_id is null then
    new.thread_id := public.get_default_club_chat_thread_id();
  end if;

  return new;
end;
$$;

drop trigger if exists chat_messages_set_default_thread_id on public.chat_messages;

create trigger chat_messages_set_default_thread_id
before insert on public.chat_messages
for each row
execute function public.set_default_chat_message_thread_id();

alter table public.chat_threads enable row level security;
alter table public.chat_thread_members enable row level security;

drop policy if exists "Authenticated users can read accessible chat threads" on public.chat_threads;
create policy "Authenticated users can read accessible chat threads"
on public.chat_threads
for select
to authenticated
using (public.can_access_chat_thread(id));

drop policy if exists "Members can read their direct thread memberships" on public.chat_thread_members;
create policy "Members can read their direct thread memberships"
on public.chat_thread_members
for select
to authenticated
using (
  exists (
    select 1
    from public.chat_threads
    where id = chat_thread_members.thread_id
      and type = 'direct_coach'
  )
  and public.is_chat_thread_member(chat_thread_members.thread_id)
);

drop policy if exists "Authenticated users can read all chat messages" on public.chat_messages;
drop policy if exists "Authenticated users can read accessible chat messages" on public.chat_messages;
create policy "Authenticated users can read accessible chat messages"
on public.chat_messages
for select
to authenticated
using (public.can_access_chat_thread(thread_id));

drop policy if exists "Users can insert chat messages as themselves" on public.chat_messages;
drop policy if exists "Users can insert chat messages into accessible threads" on public.chat_messages;
create policy "Users can insert chat messages into accessible threads"
on public.chat_messages
for insert
to authenticated
with check (
  auth.uid() = user_id
  and (
    thread_id is null
    or public.can_access_chat_thread(thread_id)
  )
);

drop policy if exists "Users can update their own chat messages" on public.chat_messages;
drop policy if exists "Users can update their own accessible chat messages" on public.chat_messages;
create policy "Users can update their own accessible chat messages"
on public.chat_messages
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

drop policy if exists "Users can delete their own chat messages" on public.chat_messages;
drop policy if exists "Users can delete their own accessible chat messages" on public.chat_messages;
create policy "Users can delete their own accessible chat messages"
on public.chat_messages
for delete
to authenticated
using (
  auth.uid() = user_id
  and public.can_access_chat_thread(thread_id)
);
