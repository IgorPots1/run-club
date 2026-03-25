insert into public.chat_thread_members (thread_id, user_id, role)
select
  thread.id,
  thread.owner_user_id,
  'member'
from public.chat_threads as thread
where thread.type = 'direct_coach'
  and thread.owner_user_id is not null
on conflict (thread_id, user_id) do nothing;

insert into public.chat_thread_members (thread_id, user_id, role)
select
  thread.id,
  thread.coach_user_id,
  'coach'
from public.chat_threads as thread
where thread.type = 'direct_coach'
  and thread.coach_user_id is not null
on conflict (thread_id, user_id) do nothing;
