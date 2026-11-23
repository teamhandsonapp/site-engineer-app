-- DPR "+ Add task": save a comment per Reason for Delay, same as PR / DPR
-- (dpr_entries.delay_reason_comments, and dependency_other_text for "Other").
-- Replaces dpr_add_task_from_site() with one extra argument p_comments.

begin;

drop function if exists public.dpr_add_task_from_site(uuid, date, date, integer, text[], text, uuid);

create or replace function public.dpr_add_task_from_site(
  p_task_id uuid,
  p_actual_start date,
  p_actual_end date,
  p_percent integer,
  p_reasons text[],
  p_note text,
  p_submitted_by uuid,
  p_comments jsonb default '{}'::jsonb
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
  v_comments jsonb;
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

  -- Only comments for reasons that are selected, non-empty.
  select coalesce(jsonb_object_agg(k, btrim(v)), '{}'::jsonb) into v_comments
    from jsonb_each_text(coalesce(p_comments, '{}'::jsonb)) as c(k, v)
   where k = any(coalesce(p_reasons, '{}')) and btrim(v) <> '';

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
          v_comments ->> 'other', v_comments, 'added_from_site', nullif(btrim(coalesce(p_note, '')), ''),
          p_submitted_by, now());

  perform set_config('app.dpr_site_add', 'off', true);
end;
$$;

revoke all on function public.dpr_add_task_from_site(uuid, date, date, integer, text[], text, uuid, jsonb) from public, anon;
grant execute on function public.dpr_add_task_from_site(uuid, date, date, integer, text[], text, uuid, jsonb) to authenticated;

commit;
