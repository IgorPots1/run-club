create index if not exists runs_user_id_created_at_idx
on public.runs (user_id, created_at desc);

create index if not exists user_challenges_user_id_completed_at_idx
on public.user_challenges (user_id, completed_at desc);

create index if not exists run_likes_created_at_idx
on public.run_likes (created_at desc);

create index if not exists run_likes_run_id_created_at_idx
on public.run_likes (run_id, created_at desc);
