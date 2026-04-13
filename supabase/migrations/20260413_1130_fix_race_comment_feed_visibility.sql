create or replace function public.can_read_race_event_comments(
  p_race_event_id uuid,
  p_viewer_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.race_events
    where race_events.id = p_race_event_id
      and (
        race_events.user_id = p_viewer_user_id
        or exists (
          select 1
          from public.app_events
          where app_events.entity_type = 'race_event'
            and app_events.entity_id = p_race_event_id
            and app_events.target_user_id is null
            and app_events.type in ('race_event.created', 'race_event.completed')
        )
      )
  );
$$;

revoke all on function public.can_read_race_event_comments(uuid, uuid) from public;
grant execute on function public.can_read_race_event_comments(uuid, uuid) to authenticated;

drop policy if exists "Authenticated users can read comments on visible entities" on public.run_comments;
create policy "Authenticated users can read comments on visible entities"
on public.run_comments
for select
to authenticated
using (
  (
    run_comments.entity_type = 'run'
    and exists (
      select 1
      from public.runs
      where runs.id = run_comments.entity_id
    )
  )
  or (
    run_comments.entity_type = 'race'
    and public.can_read_race_event_comments(run_comments.entity_id, auth.uid())
  )
);
