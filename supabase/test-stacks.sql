-- Test (2026-11-22, client): the Current Status stacks "Walls / Mezzanine"
-- and "Wall No. 4" copied onto their own tab, "Test" (board 'test',
-- lib/flowchart/data.ts).
--
-- * 13 tasks, as the stacks stand on Current Status:
--     Walls / Mezzanine: CIV-07, CIV-08, CIV-12, CIV-17, CIV-29, CIV-34, FAB-03
--     Wall No. 4:        CIV-09, CIV-13, CIV-22, GLZ-01, GLZ-02, GLZ-03
-- * Codes get a "T-" in front (T-CIV-07 …): task codes are unique.
-- * Everything copied as it is (names, departments, all dates, status, stack
--   headings), plus the links between these 13 and their delay notes.
--   Placed side by side: Walls / Mezzanine first, then Wall No. 4.
-- * Rows are soft-deleted like the Copy board, so DPR, reports, task lists,
--   Gantt and admin-web never show them; only this tab reads them
--   (flowchart_set = 'test-stacks').
-- * Current Status itself is not changed.
--
-- Only INSERTs. Safe to re-run (skips codes that already exist).
-- Undo:
--   delete from task_dependencies       where task_id in (select id from tasks where flowchart_set = 'test-stacks');
--   delete from task_parallel_links     where task_a_id in (select id from tasks where flowchart_set = 'test-stacks');
--   delete from task_checklist_notes    where task_id in (select id from tasks where flowchart_set = 'test-stacks');
--   delete from task_construction_notes where task_id in (select id from tasks where flowchart_set = 'test-stacks');
--   delete from tasks where flowchart_set = 'test-stacks';

begin;

create temp table tst_map on commit drop as
  select t.id as old_id, gen_random_uuid() as new_id, 'T-' || t.task_id as new_code,
         case when t.task_id in ('CIV-09', 'CIV-13', 'CIV-22', 'GLZ-01', 'GLZ-02', 'GLZ-03') then 231 else 0 end as new_x
  from tasks t
  where t.flowchart_set = 'flowchart-2' and t.deleted_at is null
    and t.task_id in ('CIV-07', 'CIV-08', 'CIV-12', 'CIV-17', 'CIV-29', 'CIV-34', 'FAB-03',
                      'CIV-09', 'CIV-13', 'CIV-22', 'GLZ-01', 'GLZ-02', 'GLZ-03')
    and not exists (select 1 from tasks x where x.task_id = 'T-' || t.task_id);

insert into tasks
select (jsonb_populate_record(
  null::tasks,
  to_jsonb(t) || jsonb_build_object(
    'id', m.new_id,
    'task_id', m.new_code,
    'flowchart_set', 'test-stacks',
    'manual_position_x', m.new_x,
    'description', coalesce(t.description, '') || ' (Test copy of ' || t.task_id || ')',
    'created_at', now(),
    'updated_at', now(),
    'deleted_at', now()
  )
)).*
from tasks t join tst_map m on m.old_id = t.id;

-- Links between the copied tasks only.
insert into task_dependencies
select (jsonb_populate_record(null::task_dependencies, to_jsonb(d) || jsonb_build_object('id', gen_random_uuid(), 'task_id', a.new_id, 'depends_on_task_id', b.new_id))).*
from task_dependencies d join tst_map a on a.old_id = d.task_id join tst_map b on b.old_id = d.depends_on_task_id;

insert into task_parallel_links
select (jsonb_populate_record(null::task_parallel_links, to_jsonb(l) || jsonb_build_object('id', gen_random_uuid(), 'task_a_id', a.new_id, 'task_b_id', b.new_id))).*
from task_parallel_links l join tst_map a on a.old_id = l.task_a_id join tst_map b on b.old_id = l.task_b_id;

insert into task_checklist_notes
select (jsonb_populate_record(null::task_checklist_notes, to_jsonb(n) || jsonb_build_object('task_id', m.new_id, 'updated_at', now()))).*
from task_checklist_notes n join tst_map m on m.old_id = n.task_id;

insert into task_construction_notes
select (jsonb_populate_record(null::task_construction_notes, to_jsonb(n) || jsonb_build_object('task_id', m.new_id, 'updated_at', now()))).*
from task_construction_notes n join tst_map m on m.old_id = n.task_id;

commit;

-- Check: should return 13.
-- select count(*) from tasks where flowchart_set = 'test-stacks';
