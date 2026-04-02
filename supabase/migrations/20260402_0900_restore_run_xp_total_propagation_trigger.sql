-- Restore the canonical DB-side propagation from `public.runs.xp` into
-- `public.profiles.total_xp` even if earlier trigger migrations were missed.

create or replace function public.apply_profile_total_xp_delta(
  p_user_id uuid,
  p_xp_delta integer
)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set total_xp = greatest(total_xp + coalesce(p_xp_delta, 0), 0)
  where id = p_user_id
  returning total_xp;
$$;

revoke all on function public.apply_profile_total_xp_delta(uuid, integer) from public;
revoke all on function public.apply_profile_total_xp_delta(uuid, integer) from anon;
revoke all on function public.apply_profile_total_xp_delta(uuid, integer) from authenticated;

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

revoke all on function public.apply_run_xp_to_profile_total_on_write() from public;
revoke all on function public.apply_run_xp_to_profile_total_on_write() from anon;
revoke all on function public.apply_run_xp_to_profile_total_on_write() from authenticated;

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
