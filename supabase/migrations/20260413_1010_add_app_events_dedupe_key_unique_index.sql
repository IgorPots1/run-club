create unique index if not exists app_events_dedupe_key_idx
on public.app_events (dedupe_key)
where dedupe_key is not null;
