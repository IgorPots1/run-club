alter table public.profiles
add column if not exists first_name text,
add column if not exists last_name text;

update public.profiles
set
  first_name = coalesce(
    first_name,
    nullif(split_part(btrim(name), ' ', 1), '')
  ),
  last_name = coalesce(
    last_name,
    nullif(btrim(regexp_replace(btrim(name), '^\S+\s*', '')), '')
  )
where nullif(btrim(name), '') is not null
  and (first_name is null or last_name is null);

update public.profiles
set name = nullif(concat_ws(' ', first_name, last_name), '')
where nullif(btrim(name), '') is null
  and (first_name is not null or last_name is not null);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
  v_full_name text;
begin
  v_first_name := nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last_name := nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '');
  v_full_name := nullif(
    btrim(
      coalesce(
        new.raw_user_meta_data ->> 'name',
        new.raw_user_meta_data ->> 'full_name',
        concat_ws(' ', v_first_name, v_last_name)
      )
    ),
    ''
  );

  if v_first_name is null and v_full_name is not null then
    v_first_name := nullif(split_part(v_full_name, ' ', 1), '');
  end if;

  if v_last_name is null and v_full_name is not null then
    v_last_name := nullif(btrim(regexp_replace(v_full_name, '^\S+\s*', '')), '');
  end if;

  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    name
  )
  values (
    new.id,
    new.email,
    v_first_name,
    v_last_name,
    coalesce(v_full_name, nullif(concat_ws(' ', v_first_name, v_last_name), ''))
  )
  on conflict (id) do update
  set
    email = coalesce(excluded.email, public.profiles.email),
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
    name = coalesce(public.profiles.name, excluded.name);

  return new;
end;
$$;

insert into public.profiles (
  id,
  email,
  first_name,
  last_name,
  name
)
select
  u.id,
  u.email,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
    nullif(split_part(btrim(coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name', '')), ' ', 1), '')
  ) as first_name,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'last_name'), ''),
    nullif(
      btrim(
        regexp_replace(
          btrim(coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name', '')),
          '^\S+\s*',
          ''
        )
      ),
      ''
    )
  ) as last_name,
  nullif(
    btrim(
      coalesce(
        u.raw_user_meta_data ->> 'name',
        u.raw_user_meta_data ->> 'full_name',
        concat_ws(
          ' ',
          nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
          nullif(btrim(u.raw_user_meta_data ->> 'last_name'), '')
        )
      )
    ),
    ''
  ) as name
from auth.users u
on conflict (id) do update
set
  email = coalesce(excluded.email, public.profiles.email),
  first_name = coalesce(public.profiles.first_name, excluded.first_name),
  last_name = coalesce(public.profiles.last_name, excluded.last_name),
  name = coalesce(public.profiles.name, excluded.name);
