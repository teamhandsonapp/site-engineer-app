-- Flowchart links, Step 1: lag/lead on dependency links.
--
-- Purely additive. Existing links keep working exactly as today:
--   * link types already exist (task_dependencies.type, template_links.link_type),
--     so no new type column is added;
--   * every existing row gets lag_days = 0, so an FS link still means
--     "starts the next working day after the predecessor finishes";
--   * one-link-per-pair is already enforced by the existing unique indexes
--     (task_dependencies_task_id_depends_on_task_id_key,
--      template_links_from_template_task_id_to_template_task_id_key).
--
-- lag_days counts WORKING days (Sundays + rows in public.holidays skipped);
-- negative = lead (overlap). The app clamps the picker to -30..+90; the
-- database allows -365..+365.
--
-- RLS: unchanged. The existing row policies on both tables (staff may write,
-- clients read their own project's links) already cover the new column.
--
-- Old app builds (Play v34) don't send lag_days; the default 0 applies.
-- admin-web: Prisma ignores the column on read and the default applies on
-- insert. Add `lagDays Int @default(0) @map("lag_days")` to its
-- schema.prisma before anyone ever runs `prisma db push` there.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Project links (task_dependencies: task_id = successor, depends_on_task_id = predecessor)
ALTER TABLE public.task_dependencies
  ADD COLUMN lag_days integer NOT NULL DEFAULT 0;
ALTER TABLE public.task_dependencies
  ADD CONSTRAINT task_dependencies_lag_days_range CHECK (lag_days BETWEEN -365 AND 365),
  ADD CONSTRAINT task_dependencies_no_self_link CHECK (task_id <> depends_on_task_id);

-- 2. Template Kit links (template_links: from = predecessor, to = successor)
ALTER TABLE public.template_links
  ADD COLUMN lag_days integer NOT NULL DEFAULT 0;
ALTER TABLE public.template_links
  ADD CONSTRAINT template_links_lag_days_range CHECK (lag_days BETWEEN -365 AND 365),
  ADD CONSTRAINT template_links_parallel_no_lag CHECK (link_type <> 'PARALLEL' OR lag_days = 0),
  ADD CONSTRAINT template_links_no_self_link CHECK (from_template_task_id <> to_template_task_id);

-- 3. Load a project's links without scanning every work (also covers H9):
--    the app will filter links through tasks.work_id (indexed) -> works.project_id.
CREATE INDEX works_project_id_idx ON public.works (project_id);

-- Self-check: abort everything if the result isn't exactly what we expect.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM public.task_dependencies WHERE lag_days <> 0;
  IF bad <> 0 THEN RAISE EXCEPTION 'task_dependencies: % rows with non-zero lag', bad; END IF;
  SELECT count(*) INTO bad FROM public.template_links WHERE lag_days <> 0;
  IF bad <> 0 THEN RAISE EXCEPTION 'template_links: % rows with non-zero lag', bad; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'works_project_id_idx') THEN
    RAISE EXCEPTION 'works_project_id_idx missing';
  END IF;
END $$;

-- Let PostgREST (the app's API) see the new column immediately.
NOTIFY pgrst, 'reload schema';

COMMIT;
