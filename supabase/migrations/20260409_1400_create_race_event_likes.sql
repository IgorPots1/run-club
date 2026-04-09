create table if not exists public.race_event_likes (
  race_event_id uuid not null references public.race_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (race_event_id, user_id)
);

create index if not exists race_event_likes_user_id_idx
on public.race_event_likes (user_id);

alter table public.race_event_likes enable row level security;

create or replace function public.race_event_like_target_exists(p_race_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.race_events
    where id = p_race_event_id
  );
$$;

revoke all on function public.race_event_like_target_exists(uuid) from public;
grant execute on function public.race_event_like_target_exists(uuid) to authenticated;

create or replace function public.is_race_event_like_owner(p_race_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.race_events
    where id = p_race_event_id
      and user_id = p_user_id
  );
$$;

revoke all on function public.is_race_event_like_owner(uuid, uuid) from public;
grant execute on function public.is_race_event_like_owner(uuid, uuid) to authenticated;

drop policy if exists "Authenticated users can read race event likes" on public.race_event_likes;
create policy "Authenticated users can read race event likes"
on public.race_event_likes
for select
to authenticated
using (
  public.race_event_like_target_exists(race_event_id)
);

drop policy if exists "Users can like race events as themselves" on public.race_event_likes;
create policy "Users can like race events as themselves"
on public.race_event_likes
for insert
to authenticated
with check (
  auth.uid() = user_id
  and public.race_event_like_target_exists(race_event_id)
  and not public.is_race_event_like_owner(race_event_id, auth.uid())
);

drop policy if exists "Users can remove their own race event likes" on public.race_event_likes;
create policy "Users can remove their own race event likes"
on public.race_event_likes
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.prevent_self_race_event_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
begin
  select race_events.user_id
  into v_owner_user_id
  from public.race_events
  where race_events.id = new.race_event_id;

  if v_owner_user_id is not null and v_owner_user_id = new.user_id then
    raise exception 'cannot_like_own_race_event';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_self_race_event_like() from public;
revoke all on function public.prevent_self_race_event_like() from anon;
revoke all on function public.prevent_self_race_event_like() from authenticated;

drop trigger if exists race_event_likes_prevent_self_like_before_insert on public.race_event_likes;
create trigger race_event_likes_prevent_self_like_before_insert
before insert on public.race_event_likes
for each row
execute function public.prevent_self_race_event_like();
