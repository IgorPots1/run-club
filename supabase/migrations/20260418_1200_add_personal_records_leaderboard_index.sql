create index if not exists personal_records_distance_leaderboard_idx
on public.personal_records (
  distance_meters,
  duration_seconds,
  record_date,
  user_id
);
