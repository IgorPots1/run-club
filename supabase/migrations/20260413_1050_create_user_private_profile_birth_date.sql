create table if not exists public.user_private_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_date date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_private_profile_birth_date_not_future
    check (birth_date is null or birth_date <= current_date)
);

alter table public.user_private_profile enable row level security;

create policy "Users can manage own private profile"
on public.user_private_profile
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_user_private_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_private_profile_set_updated_at on public.user_private_profile;

create trigger user_private_profile_set_updated_at
before update on public.user_private_profile
for each row
execute function public.set_user_private_profile_updated_at();
