-- Days next to every delay (2026-11-22, client): each reason-for-delay point
-- gets a small "days" box, on both the Pre-construction and Construction tabs,
-- so the reports can add up how many days each reason cost.
--
-- delay_days (jsonb): per checklist field, one entry per point, in the same
-- order as the points in that field's text, e.g.
--   {"contractorDelay": [5, 3], "equipmentDelay": [4]}
-- null = no days given. Field keys as in lib/flowchart/checklistNotes.ts.
--
-- Only adds a column; nothing existing changes.
-- Undo: alter table ... drop column delay_days; (on the three tables below)

alter table if exists public.task_checklist_notes add column if not exists delay_days jsonb;
alter table if exists public.task_construction_notes add column if not exists delay_days jsonb;
alter table if exists public.task_copy_preconstruction_notes add column if not exists delay_days jsonb;
