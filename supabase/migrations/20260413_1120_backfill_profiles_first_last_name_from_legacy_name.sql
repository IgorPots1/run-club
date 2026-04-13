update public.profiles
set
  first_name = nullif(split_part(source.name, ' ', 1), ''),
  last_name = case
    when nullif(btrim(public.profiles.last_name), '') is null
      then nullif(btrim(regexp_replace(source.name, '^\S+\s*', '')), '')
    else public.profiles.last_name
  end
from (
  select
    id,
    btrim(name) as name
  from public.profiles
  where nullif(btrim(name), '') is not null
    and nullif(btrim(first_name), '') is null
) as source
where public.profiles.id = source.id;
