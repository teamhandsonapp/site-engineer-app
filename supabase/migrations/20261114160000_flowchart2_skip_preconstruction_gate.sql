-- Flowchart 2 tasks don't use the big pre-construction checklist (2026-11-14).
--
-- They are tracked with the client's six-point checklist instead
-- (task_checklist_notes: Architect, Consultant, Client, Procurement status,
-- Lead time, Other), which is notes only and never gates anything. So for
-- tasks with flowchart_set = 'flowchart-2':
--   * recalculate_task_status keeps a not-started task at 'ready' (never
--     'draft' / 'blocked' because of dependency_items);
--   * the tasks status gate (Actual Start / status change) lets them through;
--   * assert_preconstruction_done (DPR entry gate) lets them through.
-- Every other task keeps the existing behaviour unchanged.
--
-- Data: the not-started Flowchart 2 tasks move from draft/blocked to ready.
-- Safe to re-run.

begin;

create or replace function public.recalculate_task_status(p_task_id uuid)
 returns void
 language plpgsql
 security definer
as $function$
declare
  v_status       "TaskStatus";
  v_set          text;
  v_cat_count    integer;
  v_all_complete boolean;
begin
  select status, flowchart_set into v_status, v_set from tasks where id = p_task_id;
  if v_status is null or v_status in ('in_progress', 'on_hold', 'completed') then
    return;
  end if;

  -- Flowchart 2: no pre-construction checklist gate.
  if v_set = 'flowchart-2' then
    update tasks set status = 'ready' where id = p_task_id and status in ('draft', 'blocked');
    return;
  end if;

  select count(distinct category) into v_cat_count
  from dependency_items
  where task_id = p_task_id and is_mandatory = true;

  if v_cat_count < 6 then
    update tasks set status = 'draft' where id = p_task_id and status <> 'draft';
    return;
  end if;

  -- An untouched item has no dependency_completions row -> treat as PENDING.
  select coalesce(bool_and(cat_complete), false) into v_all_complete
  from (
    select di.category, bool_and(coalesce(dc.status::text, 'PENDING') in ('YES', 'PROCEED', 'NO')) as cat_complete
    from dependency_items di
    left join dependency_completions dc on dc.item_id = di.id
    where di.task_id = p_task_id and di.is_mandatory = true
    group by di.category
  ) sub;

  if v_all_complete then
    update tasks set status = 'ready' where id = p_task_id and status in ('draft', 'blocked');
  else
    update tasks set status = 'blocked' where id = p_task_id and status in ('draft', 'ready');
  end if;
end;
$function$;

create or replace function public.trg_fn_task_status_gate()
 returns trigger
 language plpgsql
as $function$
begin
  if coalesce(current_setting('app.dpr_site_add', true), '') = 'on' then
    return new;
  end if;
  -- Flowchart 2: no pre-construction checklist gate.
  if new.flowchart_set = 'flowchart-2' then
    return new;
  end if;
  if old.status in ('draft', 'blocked')
     and new.status in ('in_progress', 'on_hold', 'completed') then
    raise exception 'Pre-construction checklist is not complete for this task — finish it before starting the DPR / construction phase.'
      using errcode = 'P0001';
  end if;
  if old.status in ('draft', 'blocked') and new.status = 'ready' then
    if exists (
      select 1
        from dependency_items di
        left join dependency_completions dc on dc.item_id = di.id
       where di.task_id = new.id and di.is_mandatory = true
         and coalesce(dc.status::text, 'PENDING') not in ('YES', 'PROCEED', 'NO')
    ) or (select count(distinct category) from dependency_items where task_id = new.id and is_mandatory = true) < 6 then
      raise exception 'Pre-construction checklist is not complete for this task — finish it before starting the DPR / construction phase.'
        using errcode = 'P0001';
    end if;
  end if;
  if new.actual_start_date is not null and old.actual_start_date is null
     and old.status in ('draft', 'blocked') and new.status in ('draft', 'blocked') then
    raise exception 'Pre-construction checklist is not complete for this task — Actual Start can be set once it is done.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

create or replace function public.assert_preconstruction_done(p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text;
  v_set    text;
begin
  select status::text, flowchart_set into v_status, v_set from tasks where id = p_task_id;
  -- Flowchart 2: no pre-construction checklist gate.
  if v_set = 'flowchart-2' then
    return;
  end if;
  if v_status in ('draft', 'blocked') then
    raise exception 'Pre-construction checklist is not complete for this task — finish it before starting the DPR / construction phase.'
      using errcode = 'P0001';
  end if;
end;
$function$;

update tasks set status = 'ready'
 where flowchart_set = 'flowchart-2' and status in ('draft', 'blocked');

commit;
