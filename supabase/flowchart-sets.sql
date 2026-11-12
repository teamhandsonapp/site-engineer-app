-- Flowchart-only archived task sets (mobile: app/(authenticated)/flowchart.tsx
-- corner "Hidden sets" toggle, lib/flowchart/data.ts fetchFlowchartSet).
--
-- 2026-11-11, start of real testing: every task that existed before today is
-- archived. Archived rows are SOFT-DELETED (deleted_at set) so DPR,
-- checklists, Task List, Gantt, reports, alerts and admin-web — which all
-- filter deleted_at IS NULL — never show them or their DPR/checklist data.
-- Only the flowchart's corner toggle reads them back, view-only.
-- Nothing is hard-deleted: un-archive a set with
--   update tasks set deleted_at = null, flowchart_set = null where flowchart_set = 'set-56';
--
-- NOTE for admin-web (shares this DB): add `flowchart_set String?` to its
-- Prisma Task model too, so a `prisma db push` there doesn't drop it.

begin;

alter table public.tasks add column if not exists flowchart_set text;

comment on column public.tasks.flowchart_set is
  'Flowchart-only archived task set (set-56, set-15, set-311). Rows stay soft-deleted so nothing else shows them; the flowchart shows them only via its hidden-sets toggle.';

-- The 15 milestone-level tasks TASK-001..TASK-015 (already soft-deleted 2026-11-09/10).
update public.tasks
   set flowchart_set = 'set-15'
 where task_id ~ '^TASK-0(0[1-9]|1[0-5])$'
   and deleted_at is not null;

-- The 56 tasks live before real testing started (all still not deleted, created 2026-11-09/10 IST).
update public.tasks
   set flowchart_set = 'set-56',
       deleted_at   = now()
 where deleted_at is null
   and flowchart_set is null
   and created_at < '2026-11-11T00:00:00+05:30';

commit;

notify pgrst, 'reload schema';
