create or replace function public.create_challenge_completed_app_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge_title text := 'Челлендж';
  v_xp_awarded integer := 0;
  v_payload jsonb;
begin
  if new.user_id is null or new.challenge_id is null then
    return new;
  end if;

  v_challenge_title := coalesce(nullif(trim(new.title_snapshot), ''), 'Челлендж');
  v_xp_awarded := greatest(coalesce(new.awarded_xp, 0), 0);
  v_payload := jsonb_build_object(
    'v', 1,
    'targetPath', '/challenges',
    'preview', jsonb_build_object(
      'title', 'Челлендж выполнен',
      'body', v_challenge_title
    ),
    'context', jsonb_build_object(
      'challengeId', new.challenge_id,
      'completedAt', new.completed_at,
      'xpAwarded', v_xp_awarded,
      'periodKey', new.period_key,
      'periodStart', new.period_start,
      'periodEnd', new.period_end
    )
  );

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
    v_payload
  );

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
    null,
    'challenge',
    new.challenge_id,
    'challenge',
    null,
    'normal',
    '/challenges',
    v_payload
  );

  return new;
end;
$$;

revoke all on function public.create_challenge_completed_app_event() from public;
revoke all on function public.create_challenge_completed_app_event() from anon;
revoke all on function public.create_challenge_completed_app_event() from authenticated;
