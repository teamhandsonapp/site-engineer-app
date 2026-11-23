-- TEST DATA (2026-11-23, client): realistic dates and delays for the
-- Past Tasks Copy L (−4'6") column, to try the L (−4'6") tab and its
-- "All delays" report. Run in the Supabase SQL editor.
--
-- Each task: planned → actual dates (late), and the delay table filled so
-- that its days add up exactly to the delay:
--   Pre-construction = actual start − planned start
--   Construction     = actual days − planned days
-- PTC-15 finishes on time (no delays).
--
-- Replaces these 7 tasks' planned / actual dates and their delay table
-- (written checklist text is left as it is).

begin;

-- 1. Dates.
with d(code, ps, pe, a_s, a_e) as (values
  ('PTC-03', '2026-07-20', '2026-07-24', '2026-07-23', '2026-07-29'),  -- pre 3 · const 2
  ('PTC-04', '2026-07-25', '2026-07-28', '2026-07-30', '2026-08-04'),  -- pre 5 · const 2
  ('PTC-08', '2026-07-29', '2026-08-03', '2026-08-05', '2026-08-12'),  -- pre 7 · const 2
  ('PTC-11', '2026-08-04', '2026-08-08', '2026-08-13', '2026-08-18'),  -- pre 9 · const 1
  ('PTC-14', '2026-08-10', '2026-08-14', '2026-08-19', '2026-08-24'),  -- pre 9 · const 1
  ('PTC-15', '2026-08-17', '2026-08-21', '2026-08-17', '2026-08-21'),  -- on time
  ('PTC-20', '2026-08-20', '2026-08-24', '2026-08-25', '2026-09-02')   -- pre 5 · const 4
)
update public.tasks t
set planned_start_date = d.ps::date,
    due_date           = d.pe::date,
    actual_start_date  = d.a_s::date,
    actual_end_date    = d.a_e::date
from d
where t.flowchart_set = 'past-tasks-copy' and t.task_id = d.code;

-- 2. Delay table, Pre-construction (task_checklist_notes, delay_days -> 'grid').
with g(code, grid) as (values
  ('PTC-03', '{"contractor.workersShortage": 3}'::jsonb),
  ('PTC-04', '{"drawings.structural": 5}'::jsonb),
  ('PTC-08', '{"drawings.architect": 4, "contractor.procurementDelay": 3}'::jsonb),
  ('PTC-11', '{"contractor.workersShortage": 5, "drawings.mep": 4}'::jsonb),
  ('PTC-14', '{"drawings.structural": 6, "contractor.procurementDelay": 3}'::jsonb),
  ('PTC-20', '{"contractor.equipmentDelay": 5}'::jsonb)
)
insert into public.task_checklist_notes (task_id, delay_days, updated_at)
select t.id, jsonb_build_object('grid', g.grid), now()
from g join public.tasks t on t.task_id = g.code and t.flowchart_set = 'past-tasks-copy'
on conflict (task_id) do update
set delay_days = coalesce(public.task_checklist_notes.delay_days, '{}'::jsonb) || jsonb_build_object('grid', excluded.delay_days -> 'grid'),
    updated_at = now();

-- 3. Delay table, Construction (task_construction_notes).
with g(code, grid) as (values
  ('PTC-03', '{"contractor.procurementDelay": 2}'::jsonb),
  ('PTC-04', '{"contractor.workersDelay": 2}'::jsonb),
  ('PTC-08', '{"contractor.equipmentDelay": 2}'::jsonb),
  ('PTC-11', '{"contractor.workersDelay": 1}'::jsonb),
  ('PTC-14', '{"contractor.equipmentDelay": 1}'::jsonb),
  ('PTC-20', '{"contractor.equipmentDelay": 4}'::jsonb)
)
insert into public.task_construction_notes (task_id, delay_days, updated_at)
select t.id, jsonb_build_object('grid', g.grid), now()
from g join public.tasks t on t.task_id = g.code and t.flowchart_set = 'past-tasks-copy'
on conflict (task_id) do update
set delay_days = coalesce(public.task_construction_notes.delay_days, '{}'::jsonb) || jsonb_build_object('grid', excluded.delay_days -> 'grid'),
    updated_at = now();

commit;

-- Check: should list 7 rows with the new dates.
select task_id, planned_start_date, due_date, actual_start_date, actual_end_date
from public.tasks
where flowchart_set = 'past-tasks-copy' and task_id in ('PTC-03','PTC-04','PTC-08','PTC-11','PTC-14','PTC-15','PTC-20')
order by actual_start_date;
