-- DPR "+ Add task" (2026-11-13): site staff report progress on a task that
-- started on site before it reached the DPR list. Additive; safe to re-run.
--
--   dpr_entries.source     'dpr' (normal) | 'added_from_site'
--   dpr_entries.site_note  reason for delay / remarks typed while adding
--   dpr_add_task_from_site(...)  one call that saves everything:
--     actual start (+ end), cumulative %, reasons, note, who + when,
--     task status -> in_progress (or completed at 100%), and today's DPR row
--     (submitted, source = added_from_site).
--
-- By decision (2026-11-13) site-added tasks BYPASS the pre-construction gate
-- (supabase/preconstruction-gate.sql): the function sets a transaction-local
-- flag that the two gate triggers honour. Normal DPR / status changes are
-- still gated exactly as before.

begin;

alter table public.dpr_entries
  add column if not exists source text not null default 'dpr',
  add column if not exists site_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dpr_entries_source_check') then
    alter table public.dpr_entries add constraint dpr_entries_source_check check (source in ('dpr', 'added_from_site'));
  end if;
end $$;

-- Gate triggers: skip only while dpr_add_task_from_site() is running.
create or replace function public.trg_fn_dpr_entry_gate()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.dpr_site_add', true), '') = 'on' then
    return new;
  end if;
  perform assert_preconstruction_done(new.task_id);
  return new;
end;
$$;

create or replace function public.trg_fn_task_status_gate()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.dpr_site_add', true), '') = 'on' then
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
$$;

create or replace function public.dpr_add_task_from_site(
  p_task_id uuid,
  p_actual_start date,
  p_actual_end date,
  p_percent integer,
  p_reasons text[],
  p_note text,
  p_submitted_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_status text;
  v_deleted timestamptz;
  v_before integer;
  v_percent integer := case when p_actual_end is not null then 100 else p_percent end;
begin
  if coalesce(current_app_role(), 'client') = 'client' then
    raise exception 'Only site staff can add tasks to the DPR.';
  end if;
  select status::text, deleted_at into v_status, v_deleted from tasks where id = p_task_id;
  if v_status is null or v_deleted is not null then
    raise exception 'Task not found.';
  end if;
  if v_status = 'completed' then
    raise exception 'This task is already completed.';
  end if;
  if p_actual_start is null or p_actual_start > v_today then
    raise exception 'Actual start can''t be empty or in the future.';
  end if;
  if p_actual_end is not null and (p_actual_end < p_actual_start or p_actual_end > v_today) then
    raise exception 'Actual end must be between the actual start and today.';
  end if;
  if v_percent is null or v_percent < 0 or v_percent > 100 then
    raise exception 'Progress must be between 0 and 100%%.';
  end if;
  if exists (select 1 from dpr_entries where task_id = p_task_id and report_date = v_today) then
    raise exception 'This task already has a DPR for today — open it from the DPR list instead.';
  end if;
  select coalesce(sum(percent_complete), 0) into v_before from dpr_entries where task_id = p_task_id;
  if v_percent < v_before then
    raise exception 'Progress can''t be lower than the last reported %.', v_before || '%';
  end if;

  perform set_config('app.dpr_site_add', 'on', true);

  update tasks
     set actual_start_date = coalesce(actual_start_date, p_actual_start),
         actual_end_date = p_actual_end,
         status = (case when v_percent >= 100 then 'completed' else 'in_progress' end)::"TaskStatus"
   where id = p_task_id;

  insert into dpr_entries (task_id, report_date, is_overall, percent_complete, dependency_categories,
                           dependency_other_text, delay_reason_comments, source, site_note,
                           submitted_by, submitted_at)
  values (p_task_id, v_today, true, v_percent - v_before,
          coalesce(p_reasons, '{}')::dpr_dependency_category[],
          null, '{}'::jsonb, 'added_from_site', nullif(btrim(coalesce(p_note, '')), ''),
          p_submitted_by, now());

  perform set_config('app.dpr_site_add', 'off', true);
end;
$$;

revoke all on function public.dpr_add_task_from_site(uuid, date, date, integer, text[], text, uuid) from public, anon;
grant execute on function public.dpr_add_task_from_site(uuid, date, date, integer, text[], text, uuid) to authenticated;

commit;
