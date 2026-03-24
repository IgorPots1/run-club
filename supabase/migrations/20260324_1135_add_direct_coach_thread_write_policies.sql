do $$
begin
  if exists (
    select 1
    from public.chat_threads
    where type = 'direct_coach'
    group by owner_user_id, coach_user_id
    having count(*) > 1
  ) then
    raise exception 'Cannot add direct coach unique index because duplicate direct_coach threads already exist.';
  end if;
end;
$$;

create unique index if not exists chat_threads_direct_coach_unique_idx
on public.chat_threads (type, owner_user_id, coach_user_id)
where type = 'direct_coach';

drop policy if exists "Authenticated users can create their own direct coach threads" on public.chat_threads;
create policy "Authenticated users can create their own direct coach threads"
on public.chat_threads
for insert
to authenticated
with check (
  type = 'direct_coach'
  and owner_user_id = auth.uid()
  and coach_user_id = '9c831c40-928d-4d0c-99f7-393b2b985290'::uuid
);

drop policy if exists "Authenticated users can add members to their direct coach threads" on public.chat_thread_members;
create policy "Authenticated users can add members to their direct coach threads"
on public.chat_thread_members
for insert
to authenticated
with check (
  user_id in (
    auth.uid(),
    '9c831c40-928d-4d0c-99f7-393b2b985290'::uuid
  )
  and (
    (user_id = auth.uid() and role = 'member')
    or (
      user_id = '9c831c40-928d-4d0c-99f7-393b2b985290'::uuid
      and role = 'coach'
    )
  )
  and exists (
    select 1
    from public.chat_threads
    where id = chat_thread_members.thread_id
      and type = 'direct_coach'
      and owner_user_id = auth.uid()
      and coach_user_id = '9c831c40-928d-4d0c-99f7-393b2b985290'::uuid
  )
);
