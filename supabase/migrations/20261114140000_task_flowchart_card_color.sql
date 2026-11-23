-- Optional per-task card background on the flowchart canvas (e.g. light red
-- '#FECACA' for "Roof beam with curing" on Flowchart 2), overriding the
-- usual Task Type / AC-AV colour. Null = the usual colour.
-- Additive only — existing rows and older app builds are unaffected.
alter table public.tasks add column if not exists flowchart_card_color text;
