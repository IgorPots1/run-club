with ranked_connections as (
  select
    id,
    row_number() over (
      partition by strava_athlete_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_rank
  from public.strava_connections
),
duplicate_connections as (
  select id
  from ranked_connections
  where row_rank > 1
)
delete from public.strava_connections
where id in (select id from duplicate_connections);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.strava_connections'::regclass
      and conname = 'strava_connections_strava_athlete_id_key'
  ) then
    if exists (
      select 1
      from pg_class index_rel
      join pg_namespace index_ns on index_ns.oid = index_rel.relnamespace
      join pg_index index_meta on index_meta.indexrelid = index_rel.oid
      where index_ns.nspname = 'public'
        and index_rel.relname = 'strava_connections_athlete_id_idx'
        and index_meta.indisunique
    ) then
      alter table public.strava_connections
      add constraint strava_connections_strava_athlete_id_key
      unique using index strava_connections_athlete_id_idx;
    else
      alter table public.strava_connections
      add constraint strava_connections_strava_athlete_id_key
      unique (strava_athlete_id);
    end if;
  end if;
end
$$;
