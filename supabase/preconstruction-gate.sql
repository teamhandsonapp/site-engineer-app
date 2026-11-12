-- Pre-construction gate (2026-11-11): a task can only enter the DPR /
-- construction phase once its whole pre-construction checklist is done.
--
-- "Checklist done" = recalculate_task_status(): every mandatory
-- dependency_items row Issued (YES, or legacy PROCEED) or Not Required (NO)
-- across all 6 categories — Pending / On Hold / Revisions block. That moves
-- the task draft/blocked -> ready automatically. Until then it stays
-- draft (no checklist) or blocked (checklist pending). This file closes the
-- ways around that:
--   1. update_task_status() can no longer move a draft/blocked task forward
--      by hand (ready / in_progress / on_hold / completed).
--   2. tasks.actual_start_date can't be set while draft/blocked.
--   3. dpr_entries can't be written for a draft/blocked task.
-- Applies to admin-web too (shared database).

begin;

create or replace function public.assert_preconstruction_done(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  select status::text into v_status from tasks where id = p_task_id;
  if v_status in ('draft', 'blocked') then
    raise exception 'Pre-construction checklist is not complete for this task — finish it before starting the DPR / construction phase.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- 1. Manual status changes out of draft/blocked.
create or replace function public.trg_fn_task_status_gate()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('draft', 'blocked')
     and new.status in ('in_progress', 'on_hold', 'completed') then
    raise exception 'Pre-construction checklist is not complete for this task — finish it before starting the DPR / construction phase.'
      using errcode = 'P0001';
  end if;
  -- ready is only ever set by recalculate_task_status() once the checklist is
  -- done; block a manual draft/blocked -> ready unless the checklist really is.
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
  -- 2. Actual Start can't be entered before the checklist is done.
  if new.actual_start_date is not null and old.actual_start_date is null
     and old.status in ('draft', 'blocked') and new.status in ('draft', 'blocked') then
    raise exception 'Pre-construction checklist is not complete for this task — Actual Start can be set once it is done.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Status recalculation: Not Required (NO) now counts as cleared, alongside
-- Issued (YES / legacy PROCEED). Otherwise unchanged from the original.
create or replace function public.recalculate_task_status(p_task_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_status       "TaskStatus";
  v_cat_count    integer;
  v_all_complete boolean;
begin
  select status into v_status from tasks where id = p_task_id;
  if v_status is null or v_status in ('in_progress', 'on_hold', 'completed') then
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
$$;

drop trigger if exists trg_task_status_gate on public.tasks;
create trigger trg_task_status_gate
  before update of status, actual_start_date on public.tasks
  for each row execute function public.trg_fn_task_status_gate();

-- 3. No DPR entries for a task still in pre-construction.
create or replace function public.trg_fn_dpr_entry_gate()
returns trigger
language plpgsql
as $$
begin
  perform assert_preconstruction_done(new.task_id);
  return new;
end;
$$;

drop trigger if exists trg_dpr_entry_gate on public.dpr_entries;
create trigger trg_dpr_entry_gate
  before insert or update on public.dpr_entries
  for each row execute function public.trg_fn_dpr_entry_gate();

commit;
