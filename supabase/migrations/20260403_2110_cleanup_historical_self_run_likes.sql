-- Remove historical self-like rows that could have awarded XP to the same user.
--
-- Cleanup condition:
-- 1. direct stored self-like evidence:
--      run_likes.user_id = run_likes.run_owner_user_id
-- 2. current ownership self-like evidence:
--      run_likes.user_id = runs.user_id
--
-- We intentionally use both conditions to catch:
-- - rows that were explicitly stored as self-likes at award time
-- - rows that still represent a self-like against the run's current owner, even
--   if `run_owner_user_id` later drifted from `runs.user_id`
--
-- The delete is idempotent, and profile totals are re-derived only for users
-- touched by deleted rows.

with abusive_run_likes as (
  select
    rl.run_id,
    rl.user_id,
    rl.run_owner_user_id,
    r.user_id as current_run_owner_user_id
  from public.run_likes rl
  join public.runs r
    on r.id = rl.run_id
  where rl.user_id = rl.run_owner_user_id
     or rl.user_id = r.user_id
),
affected_users as (
  select distinct affected_user_id as user_id
  from (
    select arl.run_owner_user_id as affected_user_id
    from abusive_run_likes arl
    where arl.run_owner_user_id is not null

    union

    select arl.current_run_owner_user_id as affected_user_id
    from abusive_run_likes arl
    where arl.current_run_owner_user_id is not null
  ) affected
),
deleted_self_likes as (
  delete from public.run_likes rl
  using abusive_run_likes arl
  where rl.run_id = arl.run_id
    and rl.user_id = arl.user_id
  returning rl.run_id, rl.user_id
)
update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id)
where p.id in (
  select au.user_id
  from affected_users au
)
  and exists (
    select 1
    from deleted_self_likes dsl
  );
