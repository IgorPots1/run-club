alter table public.user_shoes
add column if not exists max_distance_meters integer not null default 800000;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_shoes_max_distance_meters_check'
  ) then
    alter table public.user_shoes
      add constraint user_shoes_max_distance_meters_check
      check (max_distance_meters > 0);
  end if;
end
$$;
