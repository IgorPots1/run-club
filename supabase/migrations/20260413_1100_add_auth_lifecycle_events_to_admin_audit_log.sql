create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
  set email = excluded.email;

  begin
    insert into public.admin_audit_log (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      payload_before,
      payload_after
    )
    values (
      new.id,
      'auth.signup',
      'profile',
      new.id,
      '{}'::jsonb,
      jsonb_build_object(
        'email', new.email,
        'email_confirmed_at', new.email_confirmed_at
      )
    );
  exception
    when others then
      null;
  end;

  return new;
end;
$$;

create or replace function public.handle_auth_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email_confirmed_at is null
     and new.email_confirmed_at is not null
     and exists (
       select 1
       from public.profiles
       where id = new.id
     ) then
    begin
      insert into public.admin_audit_log (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        payload_before,
        payload_after
      )
      values (
        new.id,
        'auth.email_confirmed',
        'profile',
        new.id,
        jsonb_build_object(
          'email_confirmed_at', old.email_confirmed_at
        ),
        jsonb_build_object(
          'email', new.email,
          'email_confirmed_at', new.email_confirmed_at
        )
      );
    exception
      when others then
        null;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;

create trigger on_auth_user_email_confirmed
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.handle_auth_user_email_confirmed();
