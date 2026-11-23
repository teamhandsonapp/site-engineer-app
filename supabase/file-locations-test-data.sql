-- Test data for File Manager › Drawings (2026-11-12). Project: ROAST @ Kokapet
-- (has the 2 live tasks: CIVIL-790684 -> Civil Works, PLUM-795734 -> Plumbing).
-- Adds the 3 departments from the sketch that were missing, and a small
-- location tree. Safe to re-run (skips anything that already exists).
-- No files are uploaded here.

begin;

do $$
declare
  pid uuid := (select id from public.projects where name = 'ROAST @ Kokapet' limit 1);
  gf uuid; ff uuid; kitchen uuid; bed1 uuid;
begin
  if pid is null then raise exception 'Project ROAST @ Kokapet not found'; end if;

  -- Departments (codes follow lib/projects.ts codeFromDepartmentName).
  insert into public.works (id, project_id, name, code, color, created_at, updated_at)
  select gen_random_uuid(), pid, d.name, d.code, d.color, now(), now()
  from (values ('Structural', 'STRUCTUR', '#0EA5E9'),
               ('Networking', 'NETWORKI', '#8B5CF6'),
               ('Automation', 'AUTOMATI', '#EC4899')) as d(name, code, color)
  where not exists (select 1 from public.works w where w.project_id = pid and lower(w.name) = lower(d.name))
    and not exists (select 1 from public.works w where w.code = d.code);

  -- Floors
  insert into public.project_locations (project_id, parent_id, level, name, sort_order)
  values (pid, null, 'floor', 'Ground Floor', 1), (pid, null, 'floor', 'First Floor', 2), (pid, null, 'floor', 'Terrace', 3)
  on conflict do nothing;
  select id into gf from public.project_locations where project_id = pid and parent_id is null and name = 'Ground Floor';
  select id into ff from public.project_locations where project_id = pid and parent_id is null and name = 'First Floor';

  -- Rooms
  insert into public.project_locations (project_id, parent_id, level, name, sort_order)
  values (pid, gf, 'room', 'Kitchen', 1), (pid, gf, 'room', 'Living', 2), (pid, ff, 'room', 'Bedroom 1', 1)
  on conflict do nothing;
  select id into kitchen from public.project_locations where parent_id = gf and name = 'Kitchen';
  select id into bed1 from public.project_locations where parent_id = ff and name = 'Bedroom 1';

  -- Walls
  insert into public.project_locations (project_id, parent_id, level, name, sort_order)
  values (pid, kitchen, 'wall', 'Wall A', 1), (pid, kitchen, 'wall', 'Wall B', 2), (pid, bed1, 'wall', 'Wall A', 1)
  on conflict do nothing;
end $$;

commit;
