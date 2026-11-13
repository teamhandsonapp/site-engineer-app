-- Small section title shown on the flowchart canvas just above a task's card
-- (e.g. "West side", "East side" on Flowchart 2). Optional; null = no title.
-- Additive only — existing rows and older app builds are unaffected.
alter table public.tasks add column if not exists flowchart_section_title text;
