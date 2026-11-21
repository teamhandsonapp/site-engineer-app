-- Construction-stage checklist (Past Tasks, 2026-11-21, client): the task
-- sheet's Checklist tab is split into "Pre-construction" (the existing
-- task_checklist_notes) and "Construction" (this table), so delays can be
-- written separately for each stage and reported separately.
-- Same points (columns) and same access rules as task_checklist_notes.
-- Additive only — nothing existing is changed.
create table if not exists public.task_construction_notes (
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

alter table public.task_construction_notes enable row level security;

drop policy if exists "task_construction_notes readable by staff or own client" on public.task_construction_notes;
create policy "task_construction_notes readable by staff or own client" on public.task_construction_notes
  for select to authenticated
  using (
    current_app_role() <> 'client'
    or task_id in (
      select ht.id from tasks ht join works w on w.id = ht.work_id
      where w.project_id = current_client_project_id()
    )
  );

drop policy if exists "task_construction_notes writable by staff" on public.task_construction_notes;
create policy "task_construction_notes writable by staff" on public.task_construction_notes
  for insert to authenticated with check (current_app_role() <> 'client');

drop policy if exists "task_construction_notes updatable by staff" on public.task_construction_notes;
create policy "task_construction_notes updatable by staff" on public.task_construction_notes
  for update to authenticated using (current_app_role() <> 'client') with check (current_app_role() <> 'client');

drop policy if exists "task_construction_notes deletable by staff" on public.task_construction_notes;
create policy "task_construction_notes deletable by staff" on public.task_construction_notes
  for delete to authenticated using (current_app_role() <> 'client');

grant select, insert, update, delete on public.task_construction_notes to authenticated;
