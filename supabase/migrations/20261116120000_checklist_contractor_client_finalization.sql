-- Flowchart 2 checklist (2026-11-16): new point "Contractor client finalization",
-- shown next to Client approval in Sheet View. Plain text, empty = nothing written.
alter table public.task_checklist_notes
  add column if not exists contractor_client_finalization text;
