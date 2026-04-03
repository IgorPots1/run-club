alter table public.app_events
add column if not exists category text null;

alter table public.app_events
add column if not exists channel text null;

alter table public.app_events
add column if not exists priority text null;

alter table public.app_events
add column if not exists target_path text null;

alter table public.app_events
add column if not exists dedupe_key text null;

update public.app_events
set target_path = null
where target_path is not null
  and (
    btrim(target_path) = ''
    or btrim(target_path) not like '/%'
  );

update public.app_events
set target_path = btrim(target_path)
where target_path is not null
  and btrim(target_path) like '/%'
  and target_path <> btrim(target_path);

update public.app_events
set target_path = case
  when jsonb_typeof(payload -> 'targetPath') = 'string'
    and btrim(payload ->> 'targetPath') like '/%' then btrim(payload ->> 'targetPath')
  when type = 'chat_message.created'
    and nullif(btrim(payload ->> 'threadId'), '') is not null then '/messages/' || btrim(payload ->> 'threadId')
  else target_path
end
where target_path is null;

update public.app_events
set category = 'run'
where type in ('run_like.created', 'run_comment.created', 'run_comment.reply_created')
  and category is null;

update public.app_events
set category = 'challenge'
where type = 'challenge.completed'
  and category is null;

update public.app_events
set category = 'chat'
where type = 'chat_message.created'
  and category is null;

update public.app_events
set channel = 'inbox'
where type in (
  'run_like.created',
  'run_comment.created',
  'run_comment.reply_created',
  'challenge.completed'
)
  and channel is null;

update public.app_events
set channel = 'push'
where type = 'chat_message.created'
  and channel is null;

update public.app_events
set priority = 'normal'
where type in (
  'run_like.created',
  'run_comment.created',
  'run_comment.reply_created',
  'challenge.completed'
)
  and (priority is null or priority not in ('normal', 'important'));

update public.app_events as event
set priority = case
  when message.push_priority = 'important' then 'important'
  else 'normal'
end
from public.chat_messages as message
where event.type = 'chat_message.created'
  and event.entity_type = 'chat_message'
  and event.entity_id = message.id
  and (event.priority is null or event.priority not in ('normal', 'important'));

update public.app_events
set priority = 'normal'
where type = 'chat_message.created'
  and (priority is null or priority not in ('normal', 'important'));

update public.app_events
set dedupe_key = null
where dedupe_key is not null
  and btrim(dedupe_key) = '';

alter table public.app_events
drop constraint if exists app_events_priority_check;

alter table public.app_events
add constraint app_events_priority_check
check (priority is null or priority in ('normal', 'important'));

alter table public.app_events
drop constraint if exists app_events_channel_check;

alter table public.app_events
add constraint app_events_channel_check
check (channel is null or channel in ('inbox', 'push', 'both'));

alter table public.app_events
drop constraint if exists app_events_target_path_check;

alter table public.app_events
add constraint app_events_target_path_check
check (target_path is null or target_path like '/%');

alter table public.app_events
drop constraint if exists app_events_dedupe_key_check;

alter table public.app_events
add constraint app_events_dedupe_key_check
check (dedupe_key is null or btrim(dedupe_key) <> '');

create index if not exists app_events_channel_created_at_idx
on public.app_events (channel, created_at desc);

create unique index if not exists app_events_dedupe_key_unique_idx
on public.app_events (dedupe_key)
where dedupe_key is not null;

drop policy if exists "Authenticated users can insert app events" on public.app_events;

create or replace function public.create_challenge_completed_app_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge_title text := 'Челлендж';
  v_xp_awarded integer := 0;
begin
  if new.user_id is null or new.challenge_id is null then
    return new;
  end if;

  select
    coalesce(nullif(trim(ch.title), ''), 'Челлендж'),
    greatest(coalesce(ch.xp_reward, 0)::integer, 0)
  into
    v_challenge_title,
    v_xp_awarded
  from public.challenges ch
  where ch.id = new.challenge_id;

  insert into public.app_events (
    type,
    actor_user_id,
    target_user_id,
    entity_type,
    entity_id,
    category,
    channel,
    priority,
    target_path,
    payload
  )
  values (
    'challenge.completed',
    new.user_id,
    new.user_id,
    'challenge',
    new.challenge_id,
    'challenge',
    'inbox',
    'normal',
    '/challenges',
    jsonb_build_object(
      'v', 1,
      'targetPath', '/challenges',
      'preview', jsonb_build_object(
        'title', 'Челлендж выполнен',
        'body', v_challenge_title
      ),
      'context', jsonb_build_object(
        'challengeId', new.challenge_id,
        'completedAt', new.completed_at,
        'xpAwarded', v_xp_awarded
      )
    )
  );

  return new;
end;
$$;

revoke all on function public.create_challenge_completed_app_event() from public;
revoke all on function public.create_challenge_completed_app_event() from anon;
revoke all on function public.create_challenge_completed_app_event() from authenticated;
