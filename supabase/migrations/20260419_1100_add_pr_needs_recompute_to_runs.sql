alter table public.runs
add column if not exists pr_needs_recompute boolean not null default false;
