alter table public.runs
add column if not exists description text;

alter table public.runs
add column if not exists name_manually_edited boolean not null default false;

alter table public.runs
add column if not exists description_manually_edited boolean not null default false;

alter table public.runs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'runs'
      and policyname = 'Users can update their own runs'
  ) then
    create policy "Users can update their own runs"
    on public.runs
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;
end
$$;
