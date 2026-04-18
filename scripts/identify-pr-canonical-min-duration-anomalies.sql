-- Read-only audit query: canonical PR rows that would change
-- after applying minimum-duration sanity thresholds in canonical selection.
with thresholds(distance_meters, min_duration_seconds) as (
  values
    (5000, 720),
    (10000, 1440),
    (21097, 3000),
    (42195, 6300)
),
current_canonical as (
  select
    pr.user_id,
    pr.distance_meters,
    pr.id as old_canonical_personal_record_id,
    pr.duration_seconds as old_canonical_duration_seconds,
    t.min_duration_seconds
  from public.personal_records pr
  join thresholds t
    on t.distance_meters = pr.distance_meters
  where pr.duration_seconds < t.min_duration_seconds
),
ranked_replacement_candidates as (
  select
    prs.user_id,
    prs.distance_meters,
    prs.id as source_record_id,
    prs.source_type,
    prs.duration_seconds,
    row_number() over (
      partition by prs.user_id, prs.distance_meters
      order by
        prs.duration_seconds asc,
        case when prs.run_id is not null then 0 else 1 end asc,
        prs.record_date asc nulls last,
        prs.created_at asc,
        prs.id asc
    ) as candidate_rank
  from public.personal_record_sources prs
  join thresholds t
    on t.distance_meters = prs.distance_meters
  join current_canonical cc
    on cc.user_id = prs.user_id
   and cc.distance_meters = prs.distance_meters
  where prs.duration_seconds >= t.min_duration_seconds
)
select
  cc.user_id,
  cc.distance_meters,
  cc.old_canonical_personal_record_id,
  cc.old_canonical_duration_seconds,
  candidate.source_record_id as new_canonical_source_record_id,
  candidate.source_type as new_canonical_source_type,
  candidate.duration_seconds as new_canonical_duration_seconds,
  'filtered by minimum-duration sanity threshold'::text as reason
from current_canonical cc
left join ranked_replacement_candidates candidate
  on candidate.user_id = cc.user_id
 and candidate.distance_meters = cc.distance_meters
 and candidate.candidate_rank = 1
order by cc.user_id, cc.distance_meters;

-- Exact affected user IDs (copy/paste for targeted recompute).
with thresholds(distance_meters, min_duration_seconds) as (
  values
    (5000, 720),
    (10000, 1440),
    (21097, 3000),
    (42195, 6300)
)
select distinct pr.user_id
from public.personal_records pr
join thresholds t
  on t.distance_meters = pr.distance_meters
where pr.duration_seconds < t.min_duration_seconds
order by pr.user_id;
