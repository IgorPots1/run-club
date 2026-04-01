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
    payload
  )
  values (
    'challenge.completed',
    new.user_id,
    new.user_id,
    'challenge',
    new.challenge_id,
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

drop trigger if exists user_challenges_create_challenge_completed_app_event_after_insert on public.user_challenges;
create trigger user_challenges_create_challenge_completed_app_event_after_insert
after insert on public.user_challenges
for each row
execute function public.create_challenge_completed_app_event();

revoke all on function public.create_challenge_completed_app_event() from public;
revoke all on function public.create_challenge_completed_app_event() from anon;
revoke all on function public.create_challenge_completed_app_event() from authenticated;
