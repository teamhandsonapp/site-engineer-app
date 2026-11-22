-- Past Tasks Copy (2026-11-21, client): a copy of the Past Tasks board as its
-- own tab, "Past Tasks Copy" (board 'pastcopy', lib/flowchart/data.ts), laid
-- out one column per level (lib/flowchart/dateOrder.ts PAST_COPY_LEVEL_STACKS).
--
-- * Every Past Task except the two crossed out on the client's A3 print:
--   PT-02 (repeats PT-07) and PT-17. 26 tasks.
-- * Codes PT-xx → PTC-xx (task codes are unique across the database).
-- * Everything else copied as it is: names, departments, all dates, status,
--   and the Pre-construction + Construction delay notes.
-- * Rows are soft-deleted like Past Tasks, so DPR, reports, task lists, Gantt
--   and admin-web never show them; only this tab reads them
--   (flowchart_set = 'past-tasks-copy').
-- * Past Tasks itself is not changed.
--
-- Only INSERTs. Safe to re-run (skips codes that already exist).
-- Undo:
--   delete from task_checklist_notes    where task_id in (select id from tasks where flowchart_set = 'past-tasks-copy');
--   delete from task_construction_notes where task_id in (select id from tasks where flowchart_set = 'past-tasks-copy');
--   delete from tasks where flowchart_set = 'past-tasks-copy';

begin;

create temp table ptc_map on commit drop as
  select t.id as old_id, gen_random_uuid() as new_id, replace(t.task_id, 'PT-', 'PTC-') as new_code
  from tasks t
  where t.flowchart_set = 'past-tasks'
    and t.task_id not in ('PT-02', 'PT-17')
    and not exists (select 1 from tasks x where x.task_id = replace(t.task_id, 'PT-', 'PTC-'));

insert into tasks
select (jsonb_populate_record(
  null::tasks,
  to_jsonb(t) || jsonb_build_object(
    'id', m.new_id,
    'task_id', m.new_code,
    'flowchart_set', 'past-tasks-copy',
    'description', coalesce(t.description, '') || ' (Past Tasks Copy of ' || t.task_id || ')',
    'created_at', now(),
    'updated_at', now(),
    'deleted_at', now()
  )
)).*
from tasks t join ptc_map m on m.old_id = t.id;

insert into task_checklist_notes
select (jsonb_populate_record(null::task_checklist_notes, to_jsonb(n) || jsonb_build_object('task_id', m.new_id, 'updated_at', now()))).*
from task_checklist_notes n join ptc_map m on m.old_id = n.task_id;

insert into task_construction_notes
select (jsonb_populate_record(null::task_construction_notes, to_jsonb(n) || jsonb_build_object('task_id', m.new_id, 'updated_at', now()))).*
from task_construction_notes n join ptc_map m on m.old_id = n.task_id;

commit;

-- Check: should return 26.
-- select count(*) from tasks where flowchart_set = 'past-tasks-copy';
