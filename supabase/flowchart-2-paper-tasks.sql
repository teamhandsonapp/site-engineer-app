-- Flowchart 2 (2026-11-13): the 20 activities on the site sheet dated
-- 3 Nov 2026 (ROAST @ Kokapet, Civil Works) as LIVE tasks tagged
-- flowchart_set = 'flowchart-2' — shown on the Flowchart 2 tab, in the Gantt
-- and DPR, but NOT on the original flowchart.
--
-- 14 activities already existed in the archived "56 tasks" version: they are
-- COPIED (dates, status, actual dates, checklist + checklist answers kept;
-- the archived originals are untouched). 6 are new (Walls 11 & 6, Walls 8/9/10,
-- Mezzanine toilet slab, Wall No. 4 x3) with the sheet's target dates and a
-- copy of the standard checklist.
-- Missing planned start/end: end = the sheet's target date; start = the day
-- after the previous activity in the same work area (or = end for the first).
-- Each work area is linked in order with FS links. The sheet's delay notes
-- are added to the task description. Only INSERTs. Safe to re-run (skips
-- codes that already exist).

begin;

do $$
declare
  v_pid uuid := (select id from projects where name = 'ROAST @ Kokapet' limit 1);
  v_wid uuid;
  v_tpl uuid := (select id from tasks where task_id = 'CIVIL-967119');
  r record;
  it record;
  v_new uuid;
  v_nitem uuid;
  v_prev_group text := null;
  v_prev_id uuid := null;
  v_prev_end date := null;
  v_ps date;
  v_pe date;
begin
  if v_pid is null then raise exception 'Project ROAST @ Kokapet not found'; end if;
  select id into v_wid from works where project_id = v_pid and code = 'CIVIL';
  if v_wid is null then raise exception 'Civil Works department not found'; end if;
  if v_tpl is null then raise exception 'Template task CIVIL-967119 not found'; end if;

  for r in
    select * from (values
      -- seq, code, group, source (archived code) or null, name for new rows, sheet target date, note
      (1,  'FC2-01', 'Hot Kitchen',  'CIVIL-382150', null, date '2026-11-04', '5 days delay due to pump'),
      (2,  'FC2-02', 'Hot Kitchen',  'CIVIL-966162', null, date '2026-11-05', '5 days delay due to pump'),
      (3,  'FC2-03', 'Hot Kitchen',  'CIVIL-967119', null, date '2026-11-08', '5 days delay due to pump'),
      (4,  'FC2-04', 'Hot Kitchen',  'CIVIL-968024', null, date '2026-11-16', '5 days delay due to pump'),
      (5,  'FC2-05', 'Columns',      'CIVIL-552974', null, date '2026-11-04', '5 days delay due to pump; target moved from 28 Oct to 04 Nov'),
      (6,  'FC2-06', 'Columns',      'CIVIL-694667', null, date '2026-10-28', '5 days delay due to pump'),
      (7,  'FC2-07', 'Columns',      'CIVIL-971253', null, date '2026-10-28', '5 days delay due to pump'),
      (8,  'FC2-08', 'Columns',      'CIVIL-970655', null, date '2026-11-03', '5 days delay due to pump'),
      (9,  'FC2-09', 'Walls',        'CIVIL-971796', null, date '2026-10-30', '5 days delay due to curlock'),
      (10, 'FC2-10', 'Walls',        null, 'Walls No. 11 and 6 till +13''-0"',      date '2026-10-31', '5 days delay due to curlock'),
      (11, 'FC2-11', 'Walls',        null, 'Walls No. 8, 9 and 10 till +13''-0"',   date '2026-10-31', '5 days delay due to curlock'),
      (12, 'FC2-12', 'Walls',        null, 'Mezzanine toilet slab till +14''-6"',   date '2026-11-08', '5 days delay due to curlock'),
      (13, 'FC2-13', 'Wall No. 4',   null, 'Wall No. 4 till +5''-0"',               date '2026-10-31', null),
      (14, 'FC2-14', 'Wall No. 4',   null, 'Wall No. 4 till +9''-8"',               date '2026-11-05', null),
      (15, 'FC2-15', 'Wall No. 4',   null, 'Wall No. 4 till +13''-0"',              date '2026-11-11', null),
      (16, 'FC2-16', 'Wall No. 4',   'CIVIL-122498', null, date '2026-11-16', null),
      (17, 'FC2-17', 'Lift shaft',   'CIVIL-151525', null, date '2026-10-30', '7 days delay due to pump & quantity'),
      (18, 'FC2-18', 'Lift shaft',   'CIVIL-334852', null, date '2026-11-05', '7 days delay due to pump & quantity'),
      (19, 'FC2-19', 'Lift shaft',   'CIVIL-336086', null, date '2026-11-08', '7 days delay due to pump & quantity'),
      (20, 'FC2-20', 'Lift shaft',   'CIVIL-337095', null, date '2026-11-16', '7 days delay due to pump & quantity')
    ) as t(seq, code, grp, src, new_name, target, note)
    order by seq
  loop
    if r.grp is distinct from v_prev_group then
      v_prev_group := r.grp;
      v_prev_id := null;
      v_prev_end := null;
    end if;

    if exists (select 1 from tasks where task_id = r.code) then
      select id, coalesce(current_due_date, due_date) into v_prev_id, v_prev_end from tasks where task_id = r.code;
      continue;
    end if;

    if r.src is not null then
      insert into tasks (task_id, task_name, project_name, description, status, created_by, due_date, updated_at,
                         assigned_to, work_id, planned_start_date, total_sft, actual_end_date, actual_start_date,
                         task_type_id, cascade_delay_days, current_due_date, current_planned_start_date,
                         accountability_type, checklist_completed_at, checklist_completed_by,
                         checklist_verification_status, checklist_verified_by, checklist_verified_at,
                         checklist_verification_note, hidden_from_flowchart, room_type, floor_level, flowchart_set)
      select r.code, s.task_name, s.project_name,
             nullif(concat_ws(E'\n', s.description, case when r.note is not null then 'Site sheet 3 Nov 2026: ' || r.note end), ''),
             s.status, s.created_by, s.due_date, now(),
             s.assigned_to, s.work_id, s.planned_start_date, s.total_sft, s.actual_end_date, s.actual_start_date,
             s.task_type_id, s.cascade_delay_days, s.current_due_date, s.current_planned_start_date,
             s.accountability_type, s.checklist_completed_at, s.checklist_completed_by,
             s.checklist_verification_status, s.checklist_verified_by, s.checklist_verified_at,
             s.checklist_verification_note, false, s.room_type, s.floor_level, 'flowchart-2'
        from tasks s where s.task_id = r.src and s.flowchart_set = 'set-56'
      returning id into v_new;
      if v_new is null then raise exception 'Source % not found', r.src; end if;

      -- Checklist + its answers.
      for it in select * from dependency_items where task_id = (select id from tasks where task_id = r.src and flowchart_set = 'set-56') order by sort_order loop
        insert into dependency_items (task_id, category, item_label, is_mandatory, sort_order, created_at, quantity_unit, quantity_value)
        values (v_new, it.category, it.item_label, it.is_mandatory, it.sort_order, now(), it.quantity_unit, it.quantity_value)
        returning id into v_nitem;
        insert into dependency_completions (item_id, status, comment, completed_by, completed_at, updated_at, issue_date)
        select v_nitem, c.status, c.comment, c.completed_by, c.completed_at, c.updated_at, c.issue_date
          from dependency_completions c where c.item_id = it.id;
      end loop;
    else
      insert into tasks (task_id, task_name, project_name, description, status, created_by, updated_at,
                         work_id, task_type_id, hidden_from_flowchart, flowchart_set)
      select r.code, r.new_name, s.project_name,
             case when r.note is not null then 'Site sheet 3 Nov 2026: ' || r.note end,
             'blocked', s.created_by, now(), v_wid, s.task_type_id, false, 'flowchart-2'
        from tasks s where s.id = v_tpl
      returning id into v_new;
      for it in select * from dependency_items where task_id = v_tpl order by sort_order loop
        insert into dependency_items (task_id, category, item_label, is_mandatory, sort_order, created_at, quantity_unit, quantity_value)
        values (v_new, it.category, it.item_label, it.is_mandatory, it.sort_order, now(), it.quantity_unit, null);
      end loop;
    end if;

    -- Fill missing planned dates (existing ones are kept).
    select coalesce(current_due_date, due_date), coalesce(current_planned_start_date, planned_start_date) into v_pe, v_ps from tasks where id = v_new;
    if v_pe is null then
      v_pe := r.target;
      update tasks set due_date = v_pe where id = v_new;
    end if;
    if v_ps is null then
      v_ps := case when v_prev_end is null then v_pe else least(v_prev_end + 1, v_pe) end;
      update tasks set planned_start_date = v_ps where id = v_new;
    end if;

    -- FS link from the previous activity in the same work area — only when the
    -- dates agree (previous ends before this starts), so no false date warnings.
    if v_prev_id is not null and v_prev_end is not null and v_prev_end < v_ps then
      insert into task_dependencies (task_id, depends_on_task_id, type) values (v_new, v_prev_id, 'FS')
      on conflict do nothing;
    end if;

    -- New rows: set the checklist-based status (blocked until the checklist is done).
    if r.src is null then
      perform recalculate_task_status(v_new);
    end if;

    v_prev_id := v_new;
    v_prev_end := v_pe;
  end loop;
end $$;

commit;
