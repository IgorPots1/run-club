alter table public.run_comments
add column if not exists parent_id uuid null references public.run_comments (id) on delete set null;

alter table public.run_comments
add column if not exists edited_at timestamptz null;

alter table public.run_comments
add column if not exists deleted_at timestamptz null;

alter table public.run_comments
drop constraint if exists run_comments_no_self_reply;

alter table public.run_comments
add constraint run_comments_no_self_reply
check (parent_id is null or parent_id <> id);

create index if not exists run_comments_run_id_parent_id_created_at_id_idx
on public.run_comments (run_id, parent_id, created_at asc, id asc);

create or replace function public.prevent_run_comment_immutable_field_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'run_comments.user_id cannot be changed';
  end if;

  if new.run_id is distinct from old.run_id then
    raise exception 'run_comments.run_id cannot be changed';
  end if;

  if new.parent_id is distinct from old.parent_id then
    raise exception 'run_comments.parent_id cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists run_comments_prevent_immutable_field_changes on public.run_comments;

create trigger run_comments_prevent_immutable_field_changes
before update on public.run_comments
for each row
execute function public.prevent_run_comment_immutable_field_changes();

revoke all on function public.prevent_run_comment_immutable_field_changes() from public;
revoke all on function public.prevent_run_comment_immutable_field_changes() from anon;
revoke all on function public.prevent_run_comment_immutable_field_changes() from authenticated;

drop policy if exists "Users can update their own comments" on public.run_comments;
create policy "Users can update their own comments"
on public.run_comments
for update
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.runs
    where runs.id = run_comments.run_id
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.runs
    where runs.id = run_comments.run_id
  )
);
