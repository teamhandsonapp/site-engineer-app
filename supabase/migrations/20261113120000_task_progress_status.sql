-- Calculated DPR task status (2026-11-13). Additive; safe to re-run.
--
-- ONE place computes a task's progress status, on read (no stored copy that
-- can go stale, no cron: "today" is evaluated every time it's read, in India
-- time). tasks.status is NOT changed — it keeps driving the pre-construction
-- checklist workflow (draft / blocked / ready) that admin-web also uses.
--
--   task_progress_status(task_id [, today])  -> status, reason, overdue, progress, missing_dates, expected_from
--   task_progress_statuses (view)            -> the same for every live task (RLS of tasks applies)
--
-- Rules (checked in this order):
--   completed    cumulative DPR % >= 100 (or the task is marked completed)
--   yet_to_start not started, planned start today / in the future / not set
--   delayed      not started, planned start before today
--   on_hold      started, a working day from start up to yesterday (and up to
--                the planned end) has no DPR filled
--   in_progress  started, every such day filled, under 100%  (+ overdue when
--                today is after the planned end)
-- "Started" = actual start set, a filled DPR exists, or the task is
-- in_progress / on_hold. Expected days start at the actual start (falls back
-- to the earlier of planned start / first filled DPR) — so "+ Add task"
-- (started early) counts from its actual start. Today is never "missing".
-- Working days skip Sundays and dates in public.holidays.
-- A day is "filled" when its DPR was submitted (submitted_at) or filled by PR
-- (source = 'pr').

begin;

-- PR-filled days get source = 'pr' from now on (app: lib/progressReport.ts savePr).
alter table public.dpr_entries drop constraint if exists dpr_entries_source_check;
alter table public.dpr_entries
  add constraint dpr_entries_source_check check (source in ('dpr', 'added_from_site', 'pr'));

create or replace function public.task_progress_status(p_task_id uuid, p_today date default null)
returns table (status text, reason text, overdue boolean, progress integer, missing_dates date[], expected_from date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Kolkata')::date);
  v_st text;
  v_actual_start date;
  v_ps date;
  v_pe date;
  v_progress integer;
  v_first_filled date;
  v_started boolean;
  v_from date;
  v_to date;
  v_missing date[];
  v_list text;
begin
  select t.status::text, t.actual_start_date,
         coalesce(t.current_planned_start_date, t.planned_start_date),
         coalesce(t.current_due_date, t.due_date)
    into v_st, v_actual_start, v_ps, v_pe
    from tasks t where t.id = p_task_id;
  if not found then
    return;
  end if;

  select least(100, coalesce(sum(e.percent_complete), 0))::integer,
         min(e.report_date) filter (where e.submitted_at is not null or e.source = 'pr')
    into v_progress, v_first_filled
    from dpr_entries e where e.task_id = p_task_id;

  progress := v_progress;
  missing_dates := '{}';
  expected_from := null;
  overdue := false;

  -- 1. Completed (100% early: the remaining days simply aren't needed).
  if v_progress >= 100 or v_st = 'completed' then
    status := 'completed';
    reason := case when v_progress >= 100 then 'Completed: progress is 100%' else 'Completed: the task is marked completed' end;
    return next;
    return;
  end if;

  overdue := v_pe is not null and v_today > v_pe;
  v_started := v_actual_start is not null or v_first_filled is not null or v_st in ('in_progress', 'on_hold');

  -- 2 / 3. Not started: Yet to Start or Delayed.
  if not v_started then
    if v_ps is null or v_ps >= v_today then
      status := 'yet_to_start';
      reason := case
        when v_ps is null then 'Yet to Start: no planned start date yet'
        when v_ps = v_today then 'Yet to Start: planned to start today'
        else 'Yet to Start: planned to start ' || to_char(v_ps, 'FMDD Mon') end;
    else
      status := 'delayed';
      reason := 'Delayed: planned to start ' || to_char(v_ps, 'FMDD Mon') || ', not started yet';
    end if;
    return next;
    return;
  end if;

  -- 4 / 5. Started: any working day from start to min(yesterday, planned end) without a filled DPR?
  v_from := coalesce(v_actual_start, least(v_ps, v_first_filled), v_first_filled, v_ps);
  v_to := least(coalesce(v_pe, v_today - 1), v_today - 1);
  expected_from := v_from;
  v_missing := '{}';
  if v_from is not null and v_from <= v_to then
    select coalesce(array_agg(d::date order by d), '{}')
      into v_missing
      from generate_series(v_from, v_to, interval '1 day') as d
     where extract(isodow from d) <> 7
       and not exists (select 1 from holidays h where h.date = d::date)
       and not exists (
         select 1 from dpr_entries e
          where e.task_id = p_task_id and e.report_date = d::date
            and (e.submitted_at is not null or e.source = 'pr'));
  end if;
  missing_dates := v_missing;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    select string_agg(to_char(x, 'FMDD Mon'), ', ' order by x) into v_list
      from (select unnest(v_missing[1:5]) as x) s;
    status := 'on_hold';
    reason := 'On Hold: DPR' || case when array_length(v_missing, 1) > 1 then 's' else '' end
      || ' missing for ' || v_list
      || case when array_length(v_missing, 1) > 5 then ' and ' || (array_length(v_missing, 1) - 5) || ' more' else '' end;
  else
    status := 'in_progress';
    reason := 'In Progress: all DPRs up to yesterday are filled, ' || v_progress || '% done'
      || case when overdue then ' — past the planned end (' || to_char(v_pe, 'FMDD Mon') || ')' else '' end;
  end if;
  return next;
end;
$$;

revoke all on function public.task_progress_status(uuid, date) from public, anon;
grant execute on function public.task_progress_status(uuid, date) to authenticated;

-- Every live task's calculated status. security_invoker: callers only see
-- the tasks their own RLS lets them see.
create or replace view public.task_progress_statuses
with (security_invoker = true) as
select t.id as task_id, s.status, s.reason, s.overdue, s.progress, s.missing_dates, s.expected_from
  from public.tasks t
  cross join lateral public.task_progress_status(t.id) s
 where t.deleted_at is null;

grant select on public.task_progress_statuses to authenticated;

commit;
