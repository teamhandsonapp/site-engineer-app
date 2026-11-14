-- Horizontal divider line drawn across the flowchart canvas just below a
-- task's card (e.g. below "Roof beam casting (east side)" on Flowchart 2,
-- separating the site-sheet tasks from the roof/finishing tree under it).
-- Additive only — existing rows and older app builds are unaffected.
alter table public.tasks add column if not exists flowchart_divider_below boolean not null default false;
