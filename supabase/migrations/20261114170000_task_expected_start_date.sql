-- Expected Start (2026-11-14): an optional date the site expects a task to
-- really start, e.g. "client says it starts 16 Nov". Used only to work out
-- the blue "projected dates" chip on Flowchart 2; it never changes the
-- planned or actual dates and never gates anything. Additive, safe to re-run.

alter table public.tasks
  add column if not exists expected_start_date date;
