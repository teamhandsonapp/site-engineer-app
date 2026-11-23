-- Past Tasks Copy — its own copy of the Current Status tasks (2026-11-22,
-- client). Past Tasks shows the LIVE Current Status tasks below its stacks;
-- Past Tasks Copy gets a separate copy instead, so changes made there
-- (levels, dates, notes) never touch Current Status.
--
-- * All Current Status tasks (flowchart_set 'flowchart-2', not deleted): 81.
-- * Codes get "PC-" in front (PC-CIV-07 …): task codes are unique.
-- * Everything copied as it is (names, departments, dates, status, stack
--   headings, positions), plus the links between them and all three kinds
--   of delay notes (Current Status checklist, Past Works Pre-construction,
--   Construction).
-- * Rows are soft-deleted like Past Tasks, so DPR, reports, task lists, Gantt
--   and admin-web never show them; only Past Tasks Copy reads them
--   (flowchart_set = 'past-tasks-copy-status').
-- * Current Status itself is not changed.
--
-- Only INSERTs. Safe to re-run (skips codes that already exist).
-- Undo:
--   delete from task_dependencies               where task_id in (select id from tasks where flowchart_set = 'past-tasks-copy-status');
--   delete from task_parallel_links             where task_a_id in (select id from tasks where flowchart_set = 'past-tasks-copy-status');
--   delete from task_checklist_notes            where task_id in (select id from tasks where flowchart_set = 'past-tasks-copy-status');
--   delete from task_construction_notes         where task_id in (select id from tasks where flowchart_set = 'past-tasks-copy-status');
--   delete from task_copy_preconstruction_notes where task_id in (select id from tasks where flowchart_set = 'past-tasks-copy-status');
--   delete from tasks where flowchart_set = 'past-tasks-copy-status';

begin;

create temp table pcs_map on commit drop as
  select t.id as old_id, gen_random_uuid() as new_id, 'PC-' || t.task_id as new_code
  from tasks t
  where t.flowchart_set = 'flowchart-2' and t.deleted_at is null
    and not exists (select 1 from tasks x where x.task_id = 'PC-' || t.task_id);

insert into tasks
select (jsonb_populate_record(
  null::tasks,
  to_jsonb(t) || jsonb_build_object(
    'id', m.new_id,
    'task_id', m.new_code,
    'flowchart_set', 'past-tasks-copy-status',
    'description', coalesce(t.description, '') || ' (Past Tasks Copy of ' || t.task_id || ')',
    'created_at', now(),
    'updated_at', now(),
    'deleted_at', now()
  )
)).*
from tasks t join pcs_map m on m.old_id = t.id;

insert into task_dependencies
select (jsonb_populate_record(null::task_dependencies, to_jsonb(d) || jsonb_build_object('id', gen_random_uuid(), 'task_id', a.new_id, 'depends_on_task_id', b.new_id))).*
from task_dependencies d join pcs_map a on a.old_id = d.task_id join pcs_map b on b.old_id = d.depends_on_task_id;

insert into task_parallel_links
select (jsonb_populate_record(null::task_parallel_links, to_jsonb(l) || jsonb_build_object('id', gen_random_uuid(), 'task_a_id', a.new_id, 'task_b_id', b.new_id))).*
from task_parallel_links l join pcs_map a on a.old_id = l.task_a_id join pcs_map b on b.old_id = l.task_b_id;

insert into task_checklist_notes
select (jsonb_populate_record(null::task_checklist_notes, to_jsonb(n) || jsonb_build_object('task_id', m.new_id, 'updated_at', now()))).*
from task_checklist_notes n join pcs_map m on m.old_id = n.task_id;

insert into task_construction_notes
select (jsonb_populate_record(null::task_construction_notes, to_jsonb(n) || jsonb_build_object('task_id', m.new_id, 'updated_at', now()))).*
from task_construction_notes n join pcs_map m on m.old_id = n.task_id;

insert into task_copy_preconstruction_notes
select (jsonb_populate_record(null::task_copy_preconstruction_notes, to_jsonb(n) || jsonb_build_object('task_id', m.new_id, 'updated_at', now()))).*
from task_copy_preconstruction_notes n join pcs_map m on m.old_id = n.task_id;

commit;

-- Check: should return 81.
-- select count(*) from tasks where flowchart_set = 'past-tasks-copy-status';
