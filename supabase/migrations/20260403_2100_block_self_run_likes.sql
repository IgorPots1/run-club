-- Block self-likes at the database layer so a user cannot farm XP by liking
-- their own run. Keep both RLS and trigger-level enforcement for defense in depth.

drop policy if exists "Users can like runs as themselves" on public.run_likes;
create policy "Users can like runs as themselves"
on public.run_likes
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.runs r
    where r.id = run_id
      and r.user_id is distinct from auth.uid()
  )
);

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

  if v_run_owner_user_id is not null and v_run_owner_user_id = new.user_id then
    raise exception 'cannot_like_own_run';
  end if;

  new.run_owner_user_id := v_run_owner_user_id;
  new.xp_awarded := case
    when v_run_owner_user_id is null then 0
    else 5
  end;

  return new;
end;
$$;

revoke all on function public.set_run_like_event_fields() from public;
revoke all on function public.set_run_like_event_fields() from anon;
revoke all on function public.set_run_like_event_fields() from authenticated;
