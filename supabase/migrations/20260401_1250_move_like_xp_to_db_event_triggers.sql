alter table public.run_likes
add column if not exists run_owner_user_id uuid references auth.users (id) on delete cascade;

alter table public.run_likes
add column if not exists xp_awarded integer;

update public.run_likes rl
set run_owner_user_id = r.user_id
from public.runs r
where r.id = rl.run_id
  and rl.run_owner_user_id is distinct from r.user_id;

update public.run_likes
set xp_awarded = case
  when run_owner_user_id is null then 0
  else 5
end
where xp_awarded is null
   or xp_awarded is distinct from case
     when run_owner_user_id is null then 0
     else 5
   end;

alter table public.run_likes
alter column xp_awarded set default 0;

update public.run_likes
set xp_awarded = 0
where xp_awarded is null;

alter table public.run_likes
alter column xp_awarded set not null;

create or replace function public.set_run_like_event_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_owner_user_id uuid;
begin
  select r.user_id
  into v_run_owner_user_id
  from public.runs r
  where r.id = new.run_id;

  new.run_owner_user_id := v_run_owner_user_id;
  new.xp_awarded := case
    when v_run_owner_user_id is null then 0
    else 5
  end;

  return new;
end;
$$;

create or replace function public.apply_run_like_event_xp_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.run_owner_user_id is not null and coalesce(new.xp_awarded, 0) <> 0 then
    update public.profiles
    set total_xp = greatest(total_xp + new.xp_awarded, 0)
    where id = new.run_owner_user_id;
  end if;

  return new;
end;
$$;

create or replace function public.apply_run_like_event_xp_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.run_owner_user_id is not null and coalesce(old.xp_awarded, 0) <> 0 then
    update public.profiles
    set total_xp = greatest(total_xp - old.xp_awarded, 0)
    where id = old.run_owner_user_id;
  end if;

  return old;
end;
$$;

drop trigger if exists run_likes_set_event_fields_before_insert on public.run_likes;
create trigger run_likes_set_event_fields_before_insert
before insert on public.run_likes
for each row
execute function public.set_run_like_event_fields();

drop trigger if exists run_likes_apply_event_xp_after_insert on public.run_likes;
create trigger run_likes_apply_event_xp_after_insert
after insert on public.run_likes
for each row
execute function public.apply_run_like_event_xp_on_insert();

drop trigger if exists run_likes_apply_event_xp_after_delete on public.run_likes;
create trigger run_likes_apply_event_xp_after_delete
after delete on public.run_likes
for each row
execute function public.apply_run_like_event_xp_on_delete();

revoke all on function public.set_run_like_event_fields() from public;
revoke all on function public.set_run_like_event_fields() from anon;
revoke all on function public.set_run_like_event_fields() from authenticated;

revoke all on function public.apply_run_like_event_xp_on_insert() from public;
revoke all on function public.apply_run_like_event_xp_on_insert() from anon;
revoke all on function public.apply_run_like_event_xp_on_insert() from authenticated;

revoke all on function public.apply_run_like_event_xp_on_delete() from public;
revoke all on function public.apply_run_like_event_xp_on_delete() from anon;
revoke all on function public.apply_run_like_event_xp_on_delete() from authenticated;

create or replace function public.recalculate_user_total_xp(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with daily_run_xp as (
    select
      (r.created_at at time zone 'utc')::date as xp_date,
      coalesce(sum(coalesce(r.xp, 0)), 0)::integer as total
    from public.runs r
    where r.user_id = p_user_id
    group by (r.created_at at time zone 'utc')::date
  ),
  daily_challenge_xp as (
    select
      (uc.completed_at at time zone 'utc')::date as xp_date,
      coalesce(sum(greatest(coalesce(ch.xp_reward, 0)::integer, 0)), 0)::integer as total
    from public.user_challenges uc
    join public.challenges ch
      on ch.id = uc.challenge_id
    where uc.user_id = p_user_id
    group by (uc.completed_at at time zone 'utc')::date
  ),
  daily_like_xp as (
    select
      (rl.created_at at time zone 'utc')::date as xp_date,
      coalesce(sum(greatest(coalesce(rl.xp_awarded, 0)::integer, 0)), 0)::integer as total
    from public.run_likes rl
    where rl.run_owner_user_id = p_user_id
    group by (rl.created_at at time zone 'utc')::date
  ),
  xp_dates as (
    select drx.xp_date from daily_run_xp drx
    union
    select dcx.xp_date from daily_challenge_xp dcx
    union
    select dlx.xp_date from daily_like_xp dlx
  ),
  capped_daily_xp as (
    select
      xd.xp_date,
      least(
        coalesce(drx.total, 0) + coalesce(dcx.total, 0) + coalesce(dlx.total, 0),
        250
      )::integer as total
    from xp_dates xd
    left join daily_run_xp drx
      on drx.xp_date = xd.xp_date
    left join daily_challenge_xp dcx
      on dcx.xp_date = xd.xp_date
    left join daily_like_xp dlx
      on dlx.xp_date = xd.xp_date
  ),
  race_bonus_xp as (
    select coalesce(sum(coalesce(rwr.race_bonus_xp, 0)), 0)::integer as total
    from public.race_week_results rwr
    where rwr.user_id = p_user_id
  )
  select
    coalesce((select coalesce(sum(cdx.total), 0)::integer from capped_daily_xp cdx), 0)
    + coalesce((select total from race_bonus_xp), 0);
$$;

update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id);
