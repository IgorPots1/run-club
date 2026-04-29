alter table public.profiles
add column if not exists first_name text,
add column if not exists last_name text,
add column if not exists nickname text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
  v_nickname text;
  v_name text;
begin
  v_first_name := nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last_name := nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '');
  v_nickname := nullif(btrim(new.raw_user_meta_data ->> 'nickname'), '');
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(concat_ws(' ', v_first_name, v_last_name)), ''),
    nullif(btrim(new.email), '')
  );

  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    nickname,
    name
  )
  values (
    new.id,
    new.email,
    v_first_name,
    v_last_name,
    v_nickname,
    v_name
  )
  on conflict (id) do update
  set
    email = case
      when nullif(btrim(public.profiles.email), '') is null then excluded.email
      else public.profiles.email
    end,
    first_name = case
      when nullif(btrim(public.profiles.first_name), '') is null then excluded.first_name
      else public.profiles.first_name
    end,
    last_name = case
      when nullif(btrim(public.profiles.last_name), '') is null then excluded.last_name
      else public.profiles.last_name
    end,
    nickname = case
      when nullif(btrim(public.profiles.nickname), '') is null then excluded.nickname
      else public.profiles.nickname
    end,
    name = case
      when nullif(btrim(public.profiles.name), '') is null
        or nullif(btrim(public.profiles.name), '') = nullif(btrim(public.profiles.email), '')
        then excluded.name
      else public.profiles.name
    end;

  return new;
end;
$$;

with auth_profile_metadata as (
  select
    u.id,
    nullif(btrim(u.raw_user_meta_data ->> 'first_name'), '') as first_name,
    nullif(btrim(u.raw_user_meta_data ->> 'last_name'), '') as last_name,
    nullif(btrim(u.raw_user_meta_data ->> 'nickname'), '') as nickname,
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(
        btrim(
          concat_ws(
            ' ',
            nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
            nullif(btrim(u.raw_user_meta_data ->> 'last_name'), '')
          )
        ),
        ''
      ),
      nullif(btrim(u.email), '')
    ) as name
  from auth.users u
)
update public.profiles
set
  first_name = case
    when nullif(btrim(public.profiles.first_name), '') is null then auth_profile_metadata.first_name
    else public.profiles.first_name
  end,
  last_name = case
    when nullif(btrim(public.profiles.last_name), '') is null then auth_profile_metadata.last_name
    else public.profiles.last_name
  end,
  nickname = case
    when nullif(btrim(public.profiles.nickname), '') is null then auth_profile_metadata.nickname
    else public.profiles.nickname
  end,
  name = case
    when nullif(btrim(public.profiles.name), '') is null
      or nullif(btrim(public.profiles.name), '') = nullif(btrim(public.profiles.email), '')
      then auth_profile_metadata.name
    else public.profiles.name
  end
from auth_profile_metadata
where public.profiles.id = auth_profile_metadata.id
  and (
    (nullif(btrim(public.profiles.first_name), '') is null and auth_profile_metadata.first_name is not null)
    or (nullif(btrim(public.profiles.last_name), '') is null and auth_profile_metadata.last_name is not null)
    or (nullif(btrim(public.profiles.nickname), '') is null and auth_profile_metadata.nickname is not null)
    or (
      (
        nullif(btrim(public.profiles.name), '') is null
        or nullif(btrim(public.profiles.name), '') = nullif(btrim(public.profiles.email), '')
      )
      and auth_profile_metadata.name is not null
    )
  );
