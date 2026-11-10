-- Per-reason comment for each selected Reason for Delay on a DPR day.
-- dependency_categories stays the list of selected reasons; this holds one
-- comment per reason, keyed by the category value, e.g.
--   {"client": "Waiting for tile approval", "vendor": "Cement delivery late"}
-- Applied live on 2026-11-09.

alter table public.dpr_entries
  add column if not exists delay_reason_comments jsonb not null default '{}'::jsonb;

comment on column public.dpr_entries.delay_reason_comments is
  'Per-reason comment for each selected dependency_categories value, e.g. {"client":"Waiting for tile approval"}';

-- Overall progress entry: one total % for the task, typed once at the top
-- of the DPR screen instead of filling every planned day. Stored as a normal
-- dpr_entries row (dated the day it was saved) whose percent_complete is that
-- day's share, so every report's sum of percent_complete = the overall %.
-- Hidden from the day-by-day pager.
alter table public.dpr_entries
  add column if not exists is_overall boolean not null default false;

notify pgrst, 'reload schema';
