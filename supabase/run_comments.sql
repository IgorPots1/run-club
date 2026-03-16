create table if not exists public.run_comments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  comment text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint run_comments_comment_not_empty check (char_length(btrim(comment)) > 0)
);

create index if not exists run_comments_run_id_idx
on public.run_comments (run_id);

create index if not exists run_comments_created_at_idx
on public.run_comments (created_at desc);

create index if not exists run_comments_run_id_created_at_idx
on public.run_comments (run_id, created_at asc, id asc);

alter table public.run_comments enable row level security;

drop policy if exists "Authenticated users can read comments on visible runs" on public.run_comments;
create policy "Authenticated users can read comments on visible runs"
on public.run_comments
for select
to authenticated
using (
  exists (
    select 1
    from public.runs
    where runs.id = run_comments.run_id
  )
);

drop policy if exists "Users can create comments as themselves" on public.run_comments;
create policy "Users can create comments as themselves"
on public.run_comments
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.runs
    where runs.id = run_comments.run_id
  )
);
