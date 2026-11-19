-- Past Tasks (2026-11-19, client): the finished work from the sheet
-- "ROAST @ Kokapet - 65Tasks.xlsx - Checklist" as the flowchart's
-- "Past Tasks" tab (board 'past', lib/flowchart/data.ts).
--
-- * 28 tasks: the sheet's S.No 1–27 and 30 (it has no rows 28 and 29).
--   Task IDs follow the sheet: PT-01 … PT-27, PT-30.
-- * Department: Civil Works for all. Rows 20–30 say Civil Works; rows 1–19
--   have no department on the sheet (all are civil work).
-- * Dates exactly as on the sheet. Rows 1–19 have only actual dates (no year
--   on the sheet: 2026); rows 20–30 have planned and actual dates.
-- * Status completed (every row has an actual end date). No links, no checklist:
--   linking and dates are done later on the board.
-- * Laid out in a grid in sheet order (6 per row).
-- * Rows are SOFT-DELETED (deleted_at set), like the Copy board, so DPR,
--   checklists, task lists, reports, Gantt and admin-web never show them;
--   only the Past Tasks tab reads them (by flowchart_set = 'past-tasks').
--
-- Only INSERTs. Safe to re-run (skips IDs that already exist).
-- Undo: delete from tasks where flowchart_set = 'past-tasks';

begin;

do $$
declare
  v_pid uuid := (select id from projects where name = 'ROAST @ Kokapet' limit 1);
  v_wid uuid;
  v_tpl record;
  r record;
  v_i int := 0;
begin
  if v_pid is null then raise exception 'Project ROAST @ Kokapet not found'; end if;
  select id into v_wid from works where project_id = v_pid and code = 'CIVIL';
  if v_wid is null then raise exception 'Civil Works department not found'; end if;
  -- created_by / task type / project_name copied from an existing Current Status civil task.
  select created_by, task_type_id, project_name into v_tpl
    from tasks where work_id = v_wid and flowchart_set = 'flowchart-2' order by task_id limit 1;
  if v_tpl is null then raise exception 'No Current Status civil task to copy settings from'; end if;

  for r in
    select * from (values
      -- sno, name, planned start, planned end, actual start, actual end, department given on sheet
      (1,  $t$Curved wall 1st lift till 76”$t$,                              null::date, null::date, date '2026-07-24', date '2026-07-26', false),
      (2,  $t$Soil backfilling @ -2'0".$t$,                                  null, null, date '2026-07-29', date '2026-08-01', false),
      (3,  $t$West side planter @ -4-’6” level casting;$t$,                  null, null, date '2026-07-26', date '2026-07-28', false),
      (4,  $t$Curved wall 2nd lift till-4-’6”$t$,                            null, null, date '2026-07-27', date '2026-07-28', false),
      (5,  $t$Kitchen west wall casting till -2'0".$t$,                      null, null, date '2026-07-28', date '2026-07-31', false),
      (6,  $t$wall 5, 6, 11 corrections @ -8'0".$t$,                         null, null, date '2026-07-28', date '2026-07-30', false),
      (7,  $t$Soil backfilling @ -2'-0".$t$,                                 null, null, date '2026-07-28', date '2026-08-01', false),
      (8,  $t$West planter casting @ -2'-0" to -4'6" level.$t$,              null, null, date '2026-07-26', date '2026-08-02', false),
      (9,  $t$Wall 5, 6, 11 casting till -8'-0" level.$t$,                   null, null, date '2026-08-03', date '2026-08-10', false),
      (10, $t$Retaining wall casted from -4'6" to -7'6".$t$,                 null, null, date '2026-08-04', date '2026-08-10', false),
      (11, $t$Planter wall casting @ -4'6"$t$,                               null, null, date '2026-08-04', date '2026-08-07', false),
      (12, $t$Mivan shuttering for wall 5 @ -4'6" level$t$,                  null, null, date '2026-08-04', date '2026-08-10', false),
      (13, $t$Walls 5 casting @-7’-6”level till −4′-6″ level$t$,             null, null, date '2026-08-11', date '2026-08-15', false),
      (14, $t$Retaining wall casted from −2′-0″ to −4′-6″$t$,                null, null, date '2026-08-12', date '2026-08-15', false),
      (15, $t$Walls 6 and 11 casting till −4′-6″ level$t$,                   null, null, date '2026-08-16', date '2026-08-21', false),
      (16, $t$Walls 7 ,8 ,9, 10 casting till −4′-6″ level$t$,                null, null, date '2026-08-16', date '2026-08-21', false),
      (17, $t$Wall 7 and Wall 3 at planter wall$t$,                          null, null, date '2026-08-24', date '2026-08-29', false),
      (18, $t$Walls 6 and 11 casting at +3′-6″ level$t$,                     null, null, date '2026-08-22', date '2026-09-01', false),
      (19, $t$Walls 5 casting till +3′-6″ level$t$,                          null, null, date '2026-08-22', date '2026-09-01', false),
      (20, $t$Wall 8,9,10 casting till beam bottom$t$,                       date '2026-09-09', date '2026-09-15', date '2026-09-04', date '2026-09-20', true),
      (21, $t$Wall 23 Concrete Casting$t$,                                   date '2026-09-15', date '2026-09-19', date '2026-09-05', date '2026-09-14', true),
      (22, $t$+3'-6" level Slab casting$t$,                                  date '2026-09-10', date '2026-09-15', date '2026-09-15', date '2026-09-21', true),
      (23, $t$Wall 22 Concrete casting till +3'-6" level$t$,                 date '2026-09-15', date '2026-09-19', date '2026-09-16', date '2026-09-21', true),
      (24, $t$Mezzanine Slab Casting$t$,                                     date '2026-09-20', date '2026-09-27', date '2026-09-24', date '2026-10-21', true),
      (25, $t$PCC works @ -3'-6", -4'-6" & -7’-6” levels$t$,                 date '2026-09-09', date '2026-09-10', date '2026-09-28', date '2026-09-29', true),
      (26, $t$Walls 21 concrete casting$t$,                                  date '2026-09-15', date '2026-09-19', date '2026-09-30', date '2026-10-10', true),
      (27, $t$Walls 2 & 3, 1st lift, Kitchen niche concrete casting$t$,      date '2026-09-18', date '2026-09-22', date '2026-10-01', date '2026-10-10', true),
      (30, $t$3” Starter casting for mezzanine floor$t$,                     date '2026-09-19', date '2026-09-27', date '2026-10-22', date '2026-10-26', true)
    ) as t(sno, name, ps, pe, as_, ae, dept_given)
    order by sno
  loop
    v_i := v_i + 1;
    if exists (select 1 from tasks where task_id = 'PT-' || lpad(r.sno::text, 2, '0')) then continue; end if;
    insert into tasks (task_id, task_name, project_name, description, status, created_by, updated_at,
                       work_id, task_type_id, hidden_from_flowchart, flowchart_set, deleted_at,
                       planned_start_date, due_date, actual_start_date, actual_end_date,
                       manual_position_x, manual_position_y)
    values ('PT-' || lpad(r.sno::text, 2, '0'), r.name, v_tpl.project_name,
            'Past Tasks sheet (65Tasks Checklist), S.No ' || r.sno ||
              case when r.dept_given then '' else '. No department on the sheet; set to Civil Works.' end,
            'completed', v_tpl.created_by, now(),
            v_wid, v_tpl.task_type_id, false, 'past-tasks', now(),
            r.ps, r.pe, r.as_, r.ae,
            ((v_i - 1) % 6) * 231, ((v_i - 1) / 6) * 148);
  end loop;
end $$;

commit;

-- Check: should return 28.
-- select count(*) from tasks where flowchart_set = 'past-tasks';
