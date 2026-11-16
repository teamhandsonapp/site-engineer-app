-- Soft links (Flowchart 2, 2026-11-15): a link drawn for reference only —
-- it does not push projected dates and shows no date warning.
-- Additive only: existing links stay normal (false).
alter table public.task_dependencies add column if not exists is_soft boolean not null default false;
