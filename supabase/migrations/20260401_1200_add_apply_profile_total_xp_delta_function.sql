create or replace function public.apply_profile_total_xp_delta(
  p_user_id uuid,
  p_xp_delta integer
)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set total_xp = greatest(total_xp + coalesce(p_xp_delta, 0), 0)
  where id = p_user_id
  returning total_xp;
$$;

revoke all on function public.apply_profile_total_xp_delta(uuid, integer) from public;
revoke all on function public.apply_profile_total_xp_delta(uuid, integer) from anon;
revoke all on function public.apply_profile_total_xp_delta(uuid, integer) from authenticated;
