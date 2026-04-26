alter table public.race_events
add column if not exists status text not null default 'upcoming';

alter table public.race_events
add column if not exists cancelled_at timestamptz;

alter table public.race_events
add column if not exists matched_at timestamptz;

alter table public.race_events
add column if not exists match_source text;

alter table public.race_events
add column if not exists match_confidence text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'race_events_status_check'
      and conrelid = 'public.race_events'::regclass
  ) then
    alter table public.race_events
    add constraint race_events_status_check
    check (status in ('upcoming', 'completed_linked', 'completed_unlinked', 'cancelled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'race_events_match_source_check'
      and conrelid = 'public.race_events'::regclass
  ) then
    alter table public.race_events
    add constraint race_events_match_source_check
    check (match_source is null or match_source in ('auto', 'manual'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'race_events_match_confidence_check'
      and conrelid = 'public.race_events'::regclass
  ) then
    alter table public.race_events
    add constraint race_events_match_confidence_check
    check (match_confidence is null or match_confidence in ('high', 'medium', 'manual'));
  end if;
end
$$;

update public.race_events
set status = case
  when linked_run_id is not null then 'completed_linked'
  when race_date < current_date then 'completed_unlinked'
  else 'upcoming'
end
where status = 'upcoming'
  and (
    linked_run_id is not null
    or race_date < current_date
  );

do $$
declare
  duplicate_rows jsonb;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'linked_run_id', duplicates.linked_run_id,
        'rows', duplicates.rows
      )
      order by duplicates.linked_run_id
    ),
    '[]'::jsonb
  )
  into duplicate_rows
  from (
    select
      race_events.linked_run_id,
      jsonb_agg(
        jsonb_build_object(
          'id', race_events.id,
          'user_id', race_events.user_id,
          'name', race_events.name,
          'race_date', race_events.race_date,
          'created_at', race_events.created_at
        )
        order by race_events.created_at, race_events.id
      ) as rows
    from public.race_events
    where race_events.linked_run_id is not null
    group by race_events.linked_run_id
    having count(*) > 1
  ) as duplicates;

  if jsonb_array_length(duplicate_rows) > 0 then
    raise exception using
      message = 'race_events linked_run_id duplicates found',
      detail = jsonb_pretty(duplicate_rows),
      hint = 'Resolve duplicate linked_run_id rows manually before applying this migration.';
  end if;
end
$$;

create unique index if not exists race_events_linked_run_id_unique_idx
on public.race_events (linked_run_id)
where linked_run_id is not null;

create index if not exists race_events_user_status_race_date_idx
on public.race_events (user_id, status, race_date);
