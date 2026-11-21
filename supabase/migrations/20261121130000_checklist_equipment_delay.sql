-- Past Tasks checklist (2026-11-21, client): new point "Equipment delays",
-- on both the Pre-construction (task_checklist_notes) and Construction
-- (task_construction_notes) tabs. Plain text, empty = nothing written.
-- Additive only. Safe to run before or after 20261121120000.
alter table public.task_checklist_notes
  add column if not exists equipment_delay text;

alter table if exists public.task_construction_notes
  add column if not exists equipment_delay text;
