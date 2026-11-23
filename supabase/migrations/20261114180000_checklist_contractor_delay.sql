-- Client checklist: 7th point "Contractor delay" (Flowchart 2, 2026-11-14).
-- Additive only — a new nullable text column; existing rows untouched.
alter table public.task_checklist_notes add column if not exists contractor_delay text;
