create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid null,
  payload_before jsonb not null default '{}'::jsonb,
  payload_after jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_user_id_idx
on public.admin_audit_log (actor_user_id);

create index if not exists admin_audit_log_entity_type_entity_id_idx
on public.admin_audit_log (entity_type, entity_id);

create index if not exists admin_audit_log_created_at_desc_idx
on public.admin_audit_log (created_at desc);
