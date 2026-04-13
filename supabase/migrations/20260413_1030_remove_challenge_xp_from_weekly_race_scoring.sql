create or replace function public.finalize_race_week(p_race_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week public.race_weeks%rowtype;
  v_finalized_at timestamptz := timezone('utc', now());
  v_missing_profiles_count integer := 0;
begin
  select *
  into v_week
  from public.race_weeks
  where id = p_race_week_id
  for update;

  if not found then
    raise exception 'Race week % not found', p_race_week_id
      using errcode = 'P0002';
  end if;

  if v_week.status = 'finalized' then
    return;
  end if;

  if v_week.ends_at > v_finalized_at then
    raise exception 'Race week % cannot be finalized before it ends', p_race_week_id
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.race_week_results
    where race_week_id = p_race_week_id
  ) then
    raise exception 'Race week % already has snapshot rows but is not finalized', p_race_week_id
      using errcode = 'P0001';
  end if;

  with run_scores as (
    select
      r.user_id,
      coalesce(sum(r.xp), 0)::integer as run_xp,
      0::integer as like_xp,
      0::integer as challenge_xp,
      count(*)::integer as runs_count
    from public.runs r
    where r.created_at >= v_week.starts_at
      and r.created_at < v_week.ends_at
    group by r.user_id
  ),
  like_scores as (
    select
      r.user_id,
      0::integer as run_xp,
      (count(*) * 5)::integer as like_xp,
      0::integer as challenge_xp,
      0::integer as runs_count
    from public.run_likes rl
    join public.runs r
      on r.id = rl.run_id
    where rl.created_at >= v_week.starts_at
      and rl.created_at < v_week.ends_at
    group by r.user_id
  ),
  challenge_scores as (
    select
      uc.user_id,
      0::integer as run_xp,
      0::integer as like_xp,
      coalesce(sum(ch.xp_reward), 0)::integer as challenge_xp,
      0::integer as runs_count
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    where uc.completed_at >= v_week.starts_at
      and uc.completed_at < v_week.ends_at
    group by uc.user_id
  ),
  combined_scores as (
    select * from run_scores
    union all
    select * from like_scores
    union all
    select * from challenge_scores
  ),
  aggregated_scores as (
    select
      cs.user_id,
      coalesce(sum(cs.run_xp), 0)::integer as run_xp,
      coalesce(sum(cs.like_xp), 0)::integer as like_xp,
      coalesce(sum(cs.challenge_xp), 0)::integer as challenge_xp,
      coalesce(sum(cs.runs_count), 0)::integer as runs_count
    from combined_scores cs
    group by cs.user_id
  )
  select count(*)::integer
  into v_missing_profiles_count
  from aggregated_scores s
  left join public.profiles p
    on p.id = s.user_id
  where p.id is null;

  if v_missing_profiles_count > 0 then
    raise exception 'Race week % has participants without profiles rows', p_race_week_id
      using errcode = 'P0001';
  end if;

  with run_scores as (
    select
      r.user_id,
      coalesce(sum(r.xp), 0)::integer as run_xp,
      0::integer as like_xp,
      0::integer as challenge_xp,
      count(*)::integer as runs_count
    from public.runs r
    where r.created_at >= v_week.starts_at
      and r.created_at < v_week.ends_at
    group by r.user_id
  ),
  like_scores as (
    select
      r.user_id,
      0::integer as run_xp,
      (count(*) * 5)::integer as like_xp,
      0::integer as challenge_xp,
      0::integer as runs_count
    from public.run_likes rl
    join public.runs r
      on r.id = rl.run_id
    where rl.created_at >= v_week.starts_at
      and rl.created_at < v_week.ends_at
    group by r.user_id
  ),
  challenge_scores as (
    select
      uc.user_id,
      0::integer as run_xp,
      0::integer as like_xp,
      coalesce(sum(ch.xp_reward), 0)::integer as challenge_xp,
      0::integer as runs_count
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    where uc.completed_at >= v_week.starts_at
      and uc.completed_at < v_week.ends_at
    group by uc.user_id
  ),
  combined_scores as (
    select * from run_scores
    union all
    select * from like_scores
    union all
    select * from challenge_scores
  ),
  aggregated_scores as (
    select
      cs.user_id,
      coalesce(sum(cs.run_xp), 0)::integer as run_xp,
      coalesce(sum(cs.like_xp), 0)::integer as like_xp,
      coalesce(sum(cs.challenge_xp), 0)::integer as challenge_xp,
      coalesce(sum(cs.runs_count), 0)::integer as runs_count
    from combined_scores cs
    group by cs.user_id
  ),
  scored_rows as (
    select
      s.user_id,
      s.run_xp,
      s.like_xp,
      0::integer as challenge_xp,
      s.runs_count,
      (s.run_xp + s.like_xp)::integer as total_xp,
      coalesce(
        nullif(btrim(p.nickname), ''),
        nullif(btrim(p.name), ''),
        nullif(btrim(p.email), ''),
        'Бегун'
      ) as display_name_snapshot
    from aggregated_scores s
    join public.profiles p
      on p.id = s.user_id
  ),
  ranked_rows as (
    select
      sr.user_id,
      sr.run_xp,
      sr.like_xp,
      sr.challenge_xp,
      sr.runs_count,
      sr.total_xp,
      sr.display_name_snapshot,
      row_number() over (
        order by sr.total_xp desc, sr.user_id asc
      )::integer as rank
    from scored_rows sr
  ),
  inserted_results as (
    insert into public.race_week_results (
      race_week_id,
      user_id,
      rank,
      total_xp,
      run_xp,
      like_xp,
      challenge_xp,
      race_bonus_xp,
      runs_count,
      display_name_snapshot,
      finalized_at
    )
    select
      p_race_week_id,
      rr.user_id,
      rr.rank,
      rr.total_xp,
      rr.run_xp,
      rr.like_xp,
      rr.challenge_xp,
      case
        when rr.rank = 1 then 120
        when rr.rank <= 3 then 75
        when rr.rank <= 10 then 40
        else 20
      end as race_bonus_xp,
      rr.runs_count,
      rr.display_name_snapshot,
      v_finalized_at
    from ranked_rows rr
    returning user_id, rank, total_xp, race_bonus_xp
  ),
  updated_profiles as (
    update public.profiles p
    set total_xp = public.recalculate_user_total_xp(p.id)
    where p.id in (
      select ir.user_id
      from inserted_results ir
    )
    returning p.id
  )
  insert into public.user_badge_awards (
    user_id,
    badge_code,
    race_week_id,
    source_type,
    source_rank,
    awarded_at,
    meta
  )
  select
    ir.user_id,
    case ir.rank
      when 1 then 'weekly_race_1'
      when 2 then 'weekly_race_2'
      when 3 then 'weekly_race_3'
      else null
    end as badge_code,
    p_race_week_id,
    'weekly_race',
    ir.rank,
    v_finalized_at,
    jsonb_build_object(
      'rank', ir.rank,
      'weekSlug', v_week.slug
    ) as meta
  from inserted_results ir
  where ir.rank <= 3
  on conflict (user_id, badge_code, race_week_id) do nothing;

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
    dedupe_key,
    payload
  )
  select
    'weekly_race.result',
    null,
    ir.user_id,
    'race_week',
    p_race_week_id,
    'race',
    'inbox',
    case
      when ir.rank <= 3 then 'important'
      else 'normal'
    end,
    '/race/history/' || p_race_week_id::text,
    'weekly_race.result:' || p_race_week_id::text || ':' || ir.user_id::text,
    jsonb_build_object(
      'v', 1,
      'targetPath', '/race/history/' || p_race_week_id::text,
      'preview', jsonb_build_object(
        'title', case ir.rank
          when 1 then 'Ты занял 1 место в гонке недели'
          when 2 then 'Ты занял 2 место в гонке недели'
          when 3 then 'Ты занял 3 место в гонке недели'
          else 'Гонка недели завершена'
        end,
        'body', case
          when ir.rank between 4 and 5 then 'Ты занял ' || ir.rank::text || ' место. Ты был близко к призовым местам'
          when ir.rank > 3 then 'Ты занял ' || ir.rank::text || ' место'
          else coalesce(v_week.slug, 'weekly-race')
        end
      ),
      'context', jsonb_build_object(
        'raceWeekId', p_race_week_id,
        'weekSlug', v_week.slug,
        'rank', ir.rank,
        'totalXp', ir.total_xp,
        'raceBonusXp', ir.race_bonus_xp
      )
    )
  from public.race_week_results ir
  where ir.race_week_id = p_race_week_id
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  update public.race_weeks
  set
    status = 'finalized',
    finalized_at = v_finalized_at
  where id = p_race_week_id;
end;
$$;
