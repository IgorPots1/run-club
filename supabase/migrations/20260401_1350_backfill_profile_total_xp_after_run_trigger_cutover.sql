-- One-time backfill after making run XP propagation DB-canonical.
-- This recomputes `profiles.total_xp` from canonical historical sources and is
-- safe to re-run because `recalculate_user_total_xp(...)` derives totals fresh.

update public.profiles p
set total_xp = public.recalculate_user_total_xp(p.id);
