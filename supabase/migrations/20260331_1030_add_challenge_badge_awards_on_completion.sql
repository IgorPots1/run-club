create unique index if not exists user_badge_awards_challenge_completion_unique_idx
on public.user_badge_awards (
  user_id,
  badge_code,
  source_type,
  ((meta ->> 'challenge_id'))
)
where source_type = 'challenge'
  and badge_code = 'challenge_completion';

create or replace function public.award_challenge_completion_badge(
  p_user_id uuid,
  p_challenge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_completed_at timestamptz;
  v_title text;
  v_xp_reward integer := 0;
  v_completion_inserted_count integer := 0;
  v_badge_inserted_count integer := 0;
begin
  select
    c.title,
    coalesce(c.xp_reward, 0)::integer
  into
    v_title,
    v_xp_reward
  from public.challenges c
  where c.id = p_challenge_id;

  if not found then
    raise exception 'Challenge % not found', p_challenge_id
      using errcode = 'P0002';
  end if;

  insert into public.user_challenges (
    user_id,
    challenge_id,
    completed_at
  )
  values (
    p_user_id,
    p_challenge_id,
    v_now
  )
  on conflict (user_id, challenge_id) do nothing;

  get diagnostics v_completion_inserted_count = row_count;

  select uc.completed_at
  into v_completed_at
  from public.user_challenges uc
  where uc.user_id = p_user_id
    and uc.challenge_id = p_challenge_id;

  insert into public.user_badge_awards (
    user_id,
    badge_code,
    race_week_id,
    source_type,
    source_rank,
    awarded_at,
    meta
  )
  values (
    p_user_id,
    'challenge_completion',
    null,
    'challenge',
    null,
    coalesce(v_completed_at, v_now),
    jsonb_build_object(
      'challenge_id', p_challenge_id,
      'title_snapshot', v_title,
      'xp_awarded', v_xp_reward
    )
  )
  on conflict do nothing;

  get diagnostics v_badge_inserted_count = row_count;

  return jsonb_build_object(
    'completion_created', v_completion_inserted_count > 0,
    'badge_created', v_badge_inserted_count > 0,
    'completed_at', coalesce(v_completed_at, v_now)
  );
end;
$$;

revoke all on function public.award_challenge_completion_badge(uuid, uuid) from public;
revoke all on function public.award_challenge_completion_badge(uuid, uuid) from anon;
revoke all on function public.award_challenge_completion_badge(uuid, uuid) from authenticated;
