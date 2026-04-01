with ranked_user_challenges as (
  select
    uc.ctid,
    uc.user_id,
    uc.challenge_id,
    min(uc.completed_at) over (
      partition by uc.user_id, uc.challenge_id
    ) as canonical_completed_at,
    row_number() over (
      partition by uc.user_id, uc.challenge_id
      order by uc.completed_at asc, uc.ctid asc
    ) as duplicate_rank
  from public.user_challenges uc
),
canonicalized_user_challenges as (
  update public.user_challenges uc
  set
    completed_at = ranked.canonical_completed_at
  from ranked_user_challenges ranked
  where uc.ctid = ranked.ctid
    and ranked.duplicate_rank = 1
    and uc.completed_at is distinct from ranked.canonical_completed_at
  returning uc.user_id, uc.challenge_id
)
delete from public.user_challenges uc
using ranked_user_challenges ranked
where uc.ctid = ranked.ctid
  and ranked.duplicate_rank > 1;

do $$
declare
  v_user_id_attnum smallint;
  v_challenge_id_attnum smallint;
begin
  select attnum
  into v_user_id_attnum
  from pg_attribute
  where attrelid = 'public.user_challenges'::regclass
    and attname = 'user_id'
    and not attisdropped;

  select attnum
  into v_challenge_id_attnum
  from pg_attribute
  where attrelid = 'public.user_challenges'::regclass
    and attname = 'challenge_id'
    and not attisdropped;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_challenges'::regclass
      and contype in ('p', 'u')
      and conkey = array[v_user_id_attnum, v_challenge_id_attnum]::smallint[]
  ) then
    alter table public.user_challenges
    add constraint user_challenges_user_id_challenge_id_key
    unique (user_id, challenge_id);
  end if;
end
$$;

update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id);
