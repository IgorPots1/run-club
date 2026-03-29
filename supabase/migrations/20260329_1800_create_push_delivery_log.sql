create table if not exists public.push_delivery_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  sent_at timestamptz not null default now()
);

create index if not exists push_delivery_log_user_id_idx
on public.push_delivery_log (user_id);

create index if not exists push_delivery_log_thread_id_idx
on public.push_delivery_log (thread_id);

create index if not exists push_delivery_log_sent_at_idx
on public.push_delivery_log (sent_at desc);
