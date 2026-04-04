alter table public.profiles
add column if not exists role text;

update public.profiles
set role = 'user'
where role is null;

alter table public.profiles
alter column role set default 'user';

alter table public.profiles
alter column role set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
  ) then
    alter table public.profiles
    add constraint profiles_role_check
    check (role in ('user', 'coach', 'admin'));
  end if;
end
$$;
