-- Past Works tab (2026-11-21, client): the Current Status tasks copied below
-- the Past Tasks stacks get their OWN Pre-construction delays there, so their
-- delays can sit under Construction on Past Works while the Current Status
-- tab keeps its checklist (task_checklist_notes) exactly as it is.
-- Same columns and access rules as task_checklist_notes. Additive only.
create table if not exists public.task_copy_preconstruction_notes (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  architect text,
  consultant text,
  client text,
  procurement_status text,
  lead_time text,
  other text,
  contractor_delay text,
  contractor_client_finalization text,
  equipment_delay text,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.task_copy_preconstruction_notes enable row level security;

drop policy if exists "task_copy_preconstruction_notes readable by staff or own client" on public.task_copy_preconstruction_notes;
create policy "task_copy_preconstruction_notes readable by staff or own client" on public.task_copy_preconstruction_notes
  for select to authenticated
  using (
    current_app_role() <> 'client'
    or task_id in (
      select ht.id from tasks ht join works w on w.id = ht.work_id
      where w.project_id = current_client_project_id()
    )
  );

drop policy if exists "task_copy_preconstruction_notes writable by staff" on public.task_copy_preconstruction_notes;
create policy "task_copy_preconstruction_notes writable by staff" on public.task_copy_preconstruction_notes
  for insert to authenticated with check (current_app_role() <> 'client');

drop policy if exists "task_copy_preconstruction_notes updatable by staff" on public.task_copy_preconstruction_notes;
create policy "task_copy_preconstruction_notes updatable by staff" on public.task_copy_preconstruction_notes
  for update to authenticated using (current_app_role() <> 'client') with check (current_app_role() <> 'client');

drop policy if exists "task_copy_preconstruction_notes deletable by staff" on public.task_copy_preconstruction_notes;
create policy "task_copy_preconstruction_notes deletable by staff" on public.task_copy_preconstruction_notes
  for delete to authenticated using (current_app_role() <> 'client');

grant select, insert, update, delete on public.task_copy_preconstruction_notes to authenticated;
