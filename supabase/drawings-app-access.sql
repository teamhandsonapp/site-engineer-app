-- Drawings in the mobile app: access rules for the shared drawing tables and
-- the project-drawings bucket.
--
-- Today the 4 drawing tables have RLS on with NO policies, so only admin-web's
-- server (which bypasses RLS) can use them. admin-web is unaffected by this
-- file: it keeps working through its server connection exactly as before.
--
-- Rules (same as admin-web's getStaff() check, plus the agreed app extension):
--   viewers  = admin, manager, senior_site_engineer, site_engineer
--   editors  = admin, manager, senior_site_engineer   (web roles)
--   * drawings:            view = viewers; create/edit/delete = editors
--   * drawing_versions:    view = viewers; upload revision = editors
--   * drawing_tags:        view + create = viewers; edit/delete = editors
--   * drawing_tag_photos:  view + add = viewers; delete = editors
--   * clients: nothing (same as the web)
-- The web's own server checks are enforced here for app writes:
--   * a tag's linked task must be in the drawing's project
--   * a department sheet's base sheet must be in the same project
--   * a tag box must be at least 0.002 x 0.002 of the page
-- Role checks use (SELECT current_app_role()) so they run once per query.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── drawings ──────────────────────────────────────────────────────────
CREATE POLICY "drawings readable by drawing viewers" ON public.drawings
  FOR SELECT TO authenticated
  USING ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer', 'site_engineer'));
CREATE POLICY "drawings insertable by drawing editors" ON public.drawings
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'));
CREATE POLICY "drawings updatable by drawing editors" ON public.drawings
  FOR UPDATE TO authenticated
  USING ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'))
  WITH CHECK ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'));
CREATE POLICY "drawings deletable by drawing editors" ON public.drawings
  FOR DELETE TO authenticated
  USING ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'));

-- ── drawing_versions ──────────────────────────────────────────────────
CREATE POLICY "drawing_versions readable by drawing viewers" ON public.drawing_versions
  FOR SELECT TO authenticated
  USING ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer', 'site_engineer'));
CREATE POLICY "drawing_versions insertable by drawing editors" ON public.drawing_versions
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'));

-- ── drawing_tags ──────────────────────────────────────────────────────
CREATE POLICY "drawing_tags readable by drawing viewers" ON public.drawing_tags
  FOR SELECT TO authenticated
  USING ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer', 'site_engineer'));
CREATE POLICY "drawing_tags insertable by drawing viewers" ON public.drawing_tags
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer', 'site_engineer'));
CREATE POLICY "drawing_tags updatable by drawing editors" ON public.drawing_tags
  FOR UPDATE TO authenticated
  USING ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'))
  WITH CHECK ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'));
CREATE POLICY "drawing_tags deletable by drawing editors" ON public.drawing_tags
  FOR DELETE TO authenticated
  USING ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'));

-- ── drawing_tag_photos ────────────────────────────────────────────────
CREATE POLICY "drawing_tag_photos readable by drawing viewers" ON public.drawing_tag_photos
  FOR SELECT TO authenticated
  USING ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer', 'site_engineer'));
CREATE POLICY "drawing_tag_photos insertable by drawing viewers" ON public.drawing_tag_photos
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer', 'site_engineer'));
CREATE POLICY "drawing_tag_photos deletable by drawing editors" ON public.drawing_tag_photos
  FOR DELETE TO authenticated
  USING ((SELECT current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'));

-- ── The web's server-side checks, enforced for app writes ─────────────
ALTER TABLE public.drawing_tags
  ADD CONSTRAINT drawing_tags_min_box CHECK (width >= 0.002 AND height >= 0.002);

CREATE OR REPLACE FUNCTION public.drawing_tag_task_in_project() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tasks t
      JOIN works w ON w.id = t.work_id
      JOIN drawings d ON d.project_id = w.project_id
     WHERE t.id = NEW.task_id AND d.id = NEW.drawing_id
  ) THEN
    RAISE EXCEPTION 'That task is not in this project';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drawing_tags_task_in_project
  BEFORE INSERT OR UPDATE OF task_id, drawing_id ON public.drawing_tags
  FOR EACH ROW EXECUTE FUNCTION public.drawing_tag_task_in_project();

CREATE OR REPLACE FUNCTION public.drawing_base_in_project() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.base_drawing_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM drawings b WHERE b.id = NEW.base_drawing_id AND b.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'The base sheet must be in the same project';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drawings_base_in_project
  BEFORE INSERT OR UPDATE OF base_drawing_id, project_id ON public.drawings
  FOR EACH ROW EXECUTE FUNCTION public.drawing_base_in_project();

-- ── Storage: bucket project-drawings ──────────────────────────────────
-- Paths (same as admin-web): <project>/<drawing>/<uuid>.pdf for revisions,
-- <project>/<drawing>/photos/<tag>/<uuid>.<ext> for tag photos.
CREATE POLICY "drawing viewers can read drawing files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'project-drawings'
         AND (SELECT public.current_app_role()) IN ('admin', 'manager', 'senior_site_engineer', 'site_engineer'));
CREATE POLICY "drawing viewers can upload tag photos, editors drawing pdfs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-drawings' AND (
       (name LIKE '%/photos/%'
        AND (SELECT public.current_app_role()) IN ('admin', 'manager', 'senior_site_engineer', 'site_engineer'))
    OR (name NOT LIKE '%/photos/%'
        AND (SELECT public.current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'))));
CREATE POLICY "drawing editors can delete drawing files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'project-drawings'
         AND (SELECT public.current_app_role()) IN ('admin', 'manager', 'senior_site_engineer'));

-- ── Grants: no anonymous access; no table-level admin rights ─────────
REVOKE ALL ON public.drawings, public.drawing_versions, public.drawing_tags, public.drawing_tag_photos FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.drawings, public.drawing_versions, public.drawing_tags, public.drawing_tag_photos FROM authenticated;

-- ── Realtime: the open drawing's tags and photos update live in the app ─
ALTER PUBLICATION supabase_realtime ADD TABLE public.drawing_tags, public.drawing_tag_photos;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('drawings', 'drawing_versions', 'drawing_tags', 'drawing_tag_photos');
  IF n <> 13 THEN RAISE EXCEPTION 'expected 13 drawing policies, found %', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'drawing %';
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 drawing storage policies, found %', n; END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
