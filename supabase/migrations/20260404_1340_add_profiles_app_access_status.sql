alter table public.profiles
add column if not exists app_access_status text;

update public.profiles
set app_access_status = 'active'
where app_access_status is null;

alter table public.profiles
alter column app_access_status set default 'active';

alter table public.profiles
alter column app_access_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_app_access_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_app_access_status_check
    check (app_access_status in ('active', 'blocked'));
  end if;
end
$$;
