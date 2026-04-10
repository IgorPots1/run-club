create table if not exists public.challenge_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  period_type public.challenge_period_type not null default 'lifetime'::public.challenge_period_type,
  goal_unit public.challenge_goal_unit not null default 'distance_km'::public.challenge_goal_unit,
  goal_target numeric not null,
  xp_reward integer not null default 0,
  starts_at timestamptz,
  end_at timestamptz,
  badge_url text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.challenge_templates
enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'challenge_templates_goal_target_positive_check'
      and conrelid = 'public.challenge_templates'::regclass
  ) then
    alter table public.challenge_templates
    add constraint challenge_templates_goal_target_positive_check
    check (goal_target > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'challenge_templates_xp_reward_nonnegative_check'
      and conrelid = 'public.challenge_templates'::regclass
  ) then
    alter table public.challenge_templates
    add constraint challenge_templates_xp_reward_nonnegative_check
    check (xp_reward >= 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'challenge_templates_time_window_check'
      and conrelid = 'public.challenge_templates'::regclass
  ) then
    alter table public.challenge_templates
    add constraint challenge_templates_time_window_check
    check (
      starts_at is null
      or end_at is null
      or end_at > starts_at
    );
  end if;
end
$$;

alter table public.challenges
add column if not exists template_id uuid references public.challenge_templates (id) on delete set null;

alter table public.challenges
add column if not exists archived_at timestamptz;

create index if not exists challenges_template_id_idx
on public.challenges (template_id);

create index if not exists challenges_archived_at_idx
on public.challenges (archived_at);

create or replace function public.finalize_earned_challenges_for_user(p_user_id uuid)
returns table (
  out_challenge_id uuid,
  xp_awarded integer,
  completed_at timestamptz,
  badge_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
begin
  return query
  with challenge_candidates as (
    select
      ch.id as challenge_id,
      coalesce(nullif(trim(ch.title), ''), 'Челлендж') as title_snapshot,
      greatest(coalesce(ch.xp_reward, 0)::integer, 0) as xp_awarded,
      ch.goal_unit,
      ch.goal_target,
      ch.period_type,
      rp.period_key,
      rp.period_start,
      rp.period_end
    from public.challenges ch
    cross join lateral public.resolve_challenge_period_window(
      ch.period_type,
      ch.starts_at,
      ch.end_at,
      v_now
    ) rp
    where rp.is_eligible
      and ch.archived_at is null
      and ch.goal_target is not null
      and ch.goal_target > 0
      and (
        coalesce(ch.visibility, 'public') = 'public'
        or (
          coalesce(ch.visibility, 'public') = 'restricted'
          and exists (
            select 1
            from public.challenge_access_users cau
            where cau.challenge_id = ch.id
              and cau.user_id = p_user_id
          )
        )
      )
  ),
  challenge_progress as (
    select
      cc.challenge_id,
      cc.title_snapshot,
      cc.xp_awarded,
      cc.goal_unit,
      cc.goal_target,
      cc.period_key,
      cc.period_start,
      cc.period_end,
      coalesce(sum(coalesce(r.distance_km, 0)), 0)::numeric as total_distance_km,
      count(r.id)::integer as total_run_count
    from challenge_candidates cc
    left join public.runs r
      on r.user_id = p_user_id
      and (cc.period_start is null or r.created_at >= cc.period_start)
      and (cc.period_end is null or r.created_at < cc.period_end)
    group by
      cc.challenge_id,
      cc.title_snapshot,
      cc.xp_awarded,
      cc.goal_unit,
      cc.goal_target,
      cc.period_key,
      cc.period_start,
      cc.period_end
  ),
  eligible_challenges as (
    select
      cp.challenge_id,
      cp.title_snapshot,
      cp.xp_awarded,
      cp.period_key,
      cp.period_start,
      cp.period_end
    from challenge_progress cp
    where (
      cp.goal_unit = 'distance_km'::public.challenge_goal_unit
      and cp.total_distance_km >= cp.goal_target
    ) or (
      cp.goal_unit = 'run_count'::public.challenge_goal_unit
      and cp.total_run_count::numeric >= cp.goal_target
    )
  ),
  uncompleted_challenges as (
    select ec.*
    from eligible_challenges ec
    where not exists (
      select 1
      from public.user_challenges uc
      where uc.user_id = p_user_id
        and uc.challenge_id = ec.challenge_id
        and uc.period_key is not distinct from ec.period_key
    )
  ),
  inserted_non_periodic as (
    insert into public.user_challenges as uc (
      user_id,
      challenge_id,
      completed_at,
      awarded_xp,
      title_snapshot,
      period_key,
      period_start,
      period_end
    )
    select
      p_user_id,
      uc.challenge_id,
      v_now,
      uc.xp_awarded,
      uc.title_snapshot,
      null,
      uc.period_start,
      uc.period_end
    from uncompleted_challenges uc
    where uc.period_key is null
    on conflict (user_id, challenge_id) where period_key is null do nothing
    returning
      uc.challenge_id,
      uc.completed_at,
      uc.period_key
  ),
  inserted_periodic as (
    insert into public.user_challenges as uc (
      user_id,
      challenge_id,
      completed_at,
      awarded_xp,
      title_snapshot,
      period_key,
      period_start,
      period_end
    )
    select
      p_user_id,
      uc.challenge_id,
      v_now,
      uc.xp_awarded,
      uc.title_snapshot,
      uc.period_key,
      uc.period_start,
      uc.period_end
    from uncompleted_challenges uc
    where uc.period_key is not null
    on conflict (user_id, challenge_id, period_key) where period_key is not null do nothing
    returning
      uc.challenge_id,
      uc.completed_at,
      uc.period_key
  ),
  inserted_completions as (
    select
      inp.challenge_id,
      inp.completed_at,
      inp.period_key
    from inserted_non_periodic inp
    union all
    select
      ip.challenge_id,
      ip.completed_at,
      ip.period_key
    from inserted_periodic ip
  ),
  inserted_badges as (
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
      p_user_id,
      'challenge_completion',
      null,
      'challenge',
      null,
      ic.completed_at,
      jsonb_build_object(
        'challenge_id', uc.challenge_id,
        'title_snapshot', uc.title_snapshot,
        'xp_awarded', uc.xp_awarded,
        'period_key', uc.period_key,
        'period_start', uc.period_start,
        'period_end', uc.period_end
      )
    from inserted_completions ic
    join uncompleted_challenges uc
      on uc.challenge_id = ic.challenge_id
      and uc.period_key is not distinct from ic.period_key
    on conflict do nothing
    returning
      (meta ->> 'challenge_id')::uuid as badge_challenge_id,
      nullif(meta ->> 'period_key', '') as badge_period_key
  )
  select
    uc.challenge_id as out_challenge_id,
    uc.xp_awarded,
    ic.completed_at,
    ib.badge_challenge_id is not null as badge_created
  from inserted_completions ic
  join uncompleted_challenges uc
    on uc.challenge_id = ic.challenge_id
    and uc.period_key is not distinct from ic.period_key
  left join inserted_badges ib
    on ib.badge_challenge_id = ic.challenge_id
    and ib.badge_period_key is not distinct from ic.period_key
  order by ic.completed_at asc, uc.challenge_id asc;
end;
$$;

revoke all on function public.finalize_earned_challenges_for_user(uuid) from public;
revoke all on function public.finalize_earned_challenges_for_user(uuid) from anon;
revoke all on function public.finalize_earned_challenges_for_user(uuid) from authenticated;
grant execute on function public.finalize_earned_challenges_for_user(uuid) to service_role;
