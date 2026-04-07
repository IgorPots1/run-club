drop policy if exists "Users can read events targeted to themselves" on public.app_events;

create policy "Users can read targeted or public feed events"
on public.app_events
for select
to authenticated
using (
  target_user_id = auth.uid()
  or (
    target_user_id is null
    and type in ('race_event.created', 'race_event.completed')
  )
);
