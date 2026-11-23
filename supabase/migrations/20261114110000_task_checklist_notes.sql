-- Client checklist answers per task (Flowchart 2, 2026-11-14): one row per
-- task with the client's six points, as written on the checklist printout.
-- Additive only. Same access rules as task_dependencies: staff read/write,
-- a client user can read rows of their own project.
create table if not exists public.task_checklist_notes (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  architect text,
  consultant text,
  client text,
  procurement_status text,
  lead_time text,
  other text,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.task_checklist_notes enable row level security;

drop policy if exists "task_checklist_notes readable by staff or own client" on public.task_checklist_notes;
create policy "task_checklist_notes readable by staff or own client" on public.task_checklist_notes
  for select to authenticated
  using (
    current_app_role() <> 'client'
    or task_id in (
      select ht.id from tasks ht join works w on w.id = ht.work_id
      where w.project_id = current_client_project_id()
    )
  );

drop policy if exists "task_checklist_notes writable by staff" on public.task_checklist_notes;
create policy "task_checklist_notes writable by staff" on public.task_checklist_notes
  for insert to authenticated with check (current_app_role() <> 'client');

drop policy if exists "task_checklist_notes updatable by staff" on public.task_checklist_notes;
create policy "task_checklist_notes updatable by staff" on public.task_checklist_notes
  for update to authenticated using (current_app_role() <> 'client') with check (current_app_role() <> 'client');

drop policy if exists "task_checklist_notes deletable by staff" on public.task_checklist_notes;
create policy "task_checklist_notes deletable by staff" on public.task_checklist_notes
  for delete to authenticated using (current_app_role() <> 'client');

grant select, insert, update, delete on public.task_checklist_notes to authenticated;
