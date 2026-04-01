-- `public.runs.xp` remains the workout XP source of truth for each run row.
-- These triggers make live `profiles.total_xp` propagation DB-canonical, while
-- `recalculate_user_total_xp(...)` remains a repair/backfill path only.

create or replace function public.apply_run_xp_to_profile_total_on_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_xp integer;
  v_new_xp integer;
  v_xp_delta integer;
begin
  if tg_op = 'INSERT' then
    v_new_xp := greatest(coalesce(new.xp, 0), 0);

    if new.user_id is not null and v_new_xp > 0 then
      perform public.apply_profile_total_xp_delta(new.user_id, v_new_xp);
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    v_old_xp := greatest(coalesce(old.xp, 0), 0);

    if old.user_id is not null and v_old_xp > 0 then
      perform public.apply_profile_total_xp_delta(old.user_id, -v_old_xp);
    end if;

    return old;
  end if;

  v_old_xp := greatest(coalesce(old.xp, 0), 0);
  v_new_xp := greatest(coalesce(new.xp, 0), 0);

  if new.user_id is not distinct from old.user_id then
    v_xp_delta := v_new_xp - v_old_xp;

    if new.user_id is not null and v_xp_delta <> 0 then
      perform public.apply_profile_total_xp_delta(new.user_id, v_xp_delta);
    end if;

    return new;
  end if;

  if old.user_id is not null and v_old_xp > 0 then
    perform public.apply_profile_total_xp_delta(old.user_id, -v_old_xp);
  end if;

  if new.user_id is not null and v_new_xp > 0 then
    perform public.apply_profile_total_xp_delta(new.user_id, v_new_xp);
  end if;

  return new;
end;
$$;

drop trigger if exists runs_apply_xp_to_profile_total_after_insert on public.runs;
create trigger runs_apply_xp_to_profile_total_after_insert
after insert on public.runs
for each row
execute function public.apply_run_xp_to_profile_total_on_write();

drop trigger if exists runs_apply_xp_to_profile_total_after_update on public.runs;
create trigger runs_apply_xp_to_profile_total_after_update
after update of user_id, xp on public.runs
for each row
execute function public.apply_run_xp_to_profile_total_on_write();

drop trigger if exists runs_apply_xp_to_profile_total_after_delete on public.runs;
create trigger runs_apply_xp_to_profile_total_after_delete
after delete on public.runs
for each row
execute function public.apply_run_xp_to_profile_total_on_write();

revoke all on function public.apply_run_xp_to_profile_total_on_write() from public;
revoke all on function public.apply_run_xp_to_profile_total_on_write() from anon;
revoke all on function public.apply_run_xp_to_profile_total_on_write() from authenticated;
