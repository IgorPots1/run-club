alter table public.challenges
add column if not exists visibility text;

update public.challenges
set visibility = 'public'
where visibility is null;

alter table public.challenges
alter column visibility set default 'public';

alter table public.challenges
alter column visibility set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'challenges_visibility_check'
      and conrelid = 'public.challenges'::regclass
  ) then
    alter table public.challenges
    add constraint challenges_visibility_check
    check (visibility in ('public', 'restricted'));
  end if;
end
$$;

create table if not exists public.challenge_access_users (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint challenge_access_users_challenge_id_user_id_key unique (challenge_id, user_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'challenge_access_users_challenge_id_user_id_key'
      and conrelid = 'public.challenge_access_users'::regclass
  ) then
    alter table public.challenge_access_users
    add constraint challenge_access_users_challenge_id_user_id_key
    unique (challenge_id, user_id);
  end if;
end
$$;

create index if not exists challenge_access_users_challenge_id_idx
on public.challenge_access_users (challenge_id);

create index if not exists challenge_access_users_user_id_idx
on public.challenge_access_users (user_id);
