-- TEST DATA (2026-11-23, client): dummy days for the delays written as
-- checklist text on the L (−4'6") tasks before the delay table existed, so
-- the report no longer shows "days not given". Run in the Supabase SQL editor
-- after test-data-level46.sql.
--
-- Every written point (one per line) with no days yet gets 2–5 days. A point
-- whose text already says its days ("delayed by 20 days", "3d") is left as it
-- is, and fields that already have days are not touched. The delay table
-- (delay_days -> 'grid') is kept.

begin;

create temp table fieldmap (col text, key text) on commit drop;
insert into fieldmap values
  ('architect', 'architect'),
  ('consultant', 'consultant'),
  ('client', 'client'),
  ('procurement_status', 'procurementStatus'),
  ('lead_time', 'leadTime'),
  ('other', 'other'),
  ('contractor_delay', 'contractorDelay'),
  ('contractor_client_finalization', 'contractorClientFinalization'),
  ('equipment_delay', 'equipmentDelay');

create temp table l46 on commit drop as
select id from public.tasks
where flowchart_set = 'past-tasks-copy'
  and task_id in ('PTC-03','PTC-04','PTC-08','PTC-11','PTC-14','PTC-15','PTC-20');

-- Pre-construction (task_checklist_notes).
with pts as (
  select n.task_id, f.key, u.x as line, u.ord
  from public.task_checklist_notes n
  join l46 on l46.id = n.task_id
  cross join fieldmap f
  cross join lateral unnest(string_to_array(to_jsonb(n) ->> f.col, E'\n')) with ordinality as u(x, ord)
  where btrim(u.x) <> '' and (n.delay_days -> f.key) is null
),
days as (
  select task_id, key,
         jsonb_agg(case when line ~* '[0-9]{1,4}\s*(days?|d)\M' then null else 2 + (length(btrim(line)) % 4) end order by ord) as arr
  from pts group by task_id, key
),
per_task as (
  select task_id, jsonb_object_agg(key, arr) as obj
  from days
  where exists (select 1 from jsonb_array_elements(arr) as e(v) where e.v <> 'null'::jsonb)
  group by task_id
)
update public.task_checklist_notes n
set delay_days = coalesce(n.delay_days, '{}'::jsonb) || p.obj, updated_at = now()
from per_task p
where n.task_id = p.task_id;

-- Construction (task_construction_notes).
with pts as (
  select n.task_id, f.key, u.x as line, u.ord
  from public.task_construction_notes n
  join l46 on l46.id = n.task_id
  cross join fieldmap f
  cross join lateral unnest(string_to_array(to_jsonb(n) ->> f.col, E'\n')) with ordinality as u(x, ord)
  where btrim(u.x) <> '' and (n.delay_days -> f.key) is null
),
days as (
  select task_id, key,
         jsonb_agg(case when line ~* '[0-9]{1,4}\s*(days?|d)\M' then null else 2 + (length(btrim(line)) % 4) end order by ord) as arr
  from pts group by task_id, key
),
per_task as (
  select task_id, jsonb_object_agg(key, arr) as obj
  from days
  where exists (select 1 from jsonb_array_elements(arr) as e(v) where e.v <> 'null'::jsonb)
  group by task_id
)
update public.task_construction_notes n
set delay_days = coalesce(n.delay_days, '{}'::jsonb) || p.obj, updated_at = now()
from per_task p
where n.task_id = p.task_id;

commit;

-- Check: the days now stored per task and stage.
select t.task_id, 'Pre-con' as stage, n.delay_days
from public.task_checklist_notes n join public.tasks t on t.id = n.task_id
where t.flowchart_set = 'past-tasks-copy' and t.task_id in ('PTC-03','PTC-04','PTC-08','PTC-11','PTC-14','PTC-15','PTC-20')
union all
select t.task_id, 'Const', n.delay_days
from public.task_construction_notes n join public.tasks t on t.id = n.task_id
where t.flowchart_set = 'past-tasks-copy' and t.task_id in ('PTC-03','PTC-04','PTC-08','PTC-11','PTC-14','PTC-15','PTC-20')
order by 1, 2 desc;
