alter table public.strava_connections
  add column if not exists rate_limited_until timestamptz;
