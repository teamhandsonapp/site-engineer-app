-- File Manager › Drawings by LOCATION + DEPARTMENT, linked to tasks (2026-11-12).
-- Additive only: two new tables + three new nullable columns on project_files.
-- Nothing existing is renamed, dropped or rewritten. Only drawings (folder =
-- 'drawings') must have a department; other folders keep working as before.
--
--   public.project_locations   per-project tree: floor -> room -> wall
--   public.project_files       + location_id (any level, optional)
--                              + department_id (works.id; required for new drawings)
--                              + revision_label (optional, e.g. "R2", "Rev C")
--   public.file_task_links     file <-> task, many-to-many
--
-- Access matches project_files exactly: staff (any non-client role) read and
-- write; a client reads only their own project.

begin;

-- ─── 1. Locations tree ──────────────────────────────────────────────────
create table if not exists public.project_locations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  parent_id   uuid references public.project_locations(id) on delete cascade,
  level       text not null check (level in ('floor', 'room', 'wall')),
  name        text not null check (length(btrim(name)) between 1 and 60),
  sort_order  int  not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- Unique name per parent (case-insensitive); floors are unique per project.
create unique index if not exists project_locations_unique_name
  on public.project_locations (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index if not exists project_locations_parent_idx on public.project_locations (parent_id);

-- Shape rules: floor has no parent; room sits under a floor; wall under a
-- room; parent must be in the same project.
create or replace function public.project_locations_check_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p_level text;
  p_project uuid;
begin
  if new.level = 'floor' then
    if new.parent_id is not null then raise exception 'A floor cannot have a parent'; end if;
    return new;
  end if;
  if new.parent_id is null then raise exception 'A % needs a parent', new.level; end if;
  select level, project_id into p_level, p_project from public.project_locations where id = new.parent_id;
  if p_project is distinct from new.project_id then raise exception 'Parent location is in another project'; end if;
  if (new.level = 'room' and p_level <> 'floor') or (new.level = 'wall' and p_level <> 'room') then
    raise exception 'A % must sit under a %', new.level, case new.level when 'room' then 'floor' else 'room' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_locations_shape on public.project_locations;
create trigger trg_project_locations_shape
  before insert or update of parent_id, level, project_id on public.project_locations
  for each row execute function public.project_locations_check_shape();

-- ─── 2. project_files: location, department, revision ───────────────────
alter table public.project_files
  add column if not exists location_id    uuid references public.project_locations(id) on delete set null,
  add column if not exists department_id  uuid references public.works(id) on delete restrict,
  add column if not exists revision_label text;

-- Department required for NEW drawings only (existing rows / other folders untouched).
create or replace function public.project_files_require_department()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.folder = 'drawings' and new.department_id is null then
    raise exception 'Pick a department for this drawing';
  end if;
  if new.location_id is not null and not exists (
    select 1 from public.project_locations l where l.id = new.location_id and l.project_id = new.project_id
  ) then
    raise exception 'Location belongs to another project';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_files_department on public.project_files;
create trigger trg_project_files_department
  before insert or update of folder, department_id, location_id on public.project_files
  for each row execute function public.project_files_require_department();

create index if not exists project_files_project_dept_idx
  on public.project_files (project_id, department_id) where deleted_at is null;
create index if not exists project_files_location_idx
  on public.project_files (location_id) where deleted_at is null;

-- ─── 3. File <-> task links ─────────────────────────────────────────────
create table if not exists public.file_task_links (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.project_files(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (file_id, task_id)            -- also serves "links by file"
);
create index if not exists file_task_links_task_idx on public.file_task_links (task_id);

-- ─── 4. RLS (same rules as project_files) ───────────────────────────────
alter table public.project_locations enable row level security;
alter table public.file_task_links  enable row level security;

drop policy if exists "project_locations read" on public.project_locations;
create policy "project_locations read" on public.project_locations
  for select to authenticated
  using ((select public.current_app_role()) <> 'client'
         or project_id = (select public.current_client_project_id()));

drop policy if exists "project_locations write" on public.project_locations;
create policy "project_locations write" on public.project_locations
  for all to authenticated
  using ((select public.current_app_role()) <> 'client')
  with check ((select public.current_app_role()) <> 'client');

drop policy if exists "file_task_links read" on public.file_task_links;
create policy "file_task_links read" on public.file_task_links
  for select to authenticated
  using ((select public.current_app_role()) <> 'client'
         or exists (select 1 from public.project_files f
                    where f.id = file_id and f.project_id = (select public.current_client_project_id())));

drop policy if exists "file_task_links write" on public.file_task_links;
create policy "file_task_links write" on public.file_task_links
  for all to authenticated
  using ((select public.current_app_role()) <> 'client')
  with check ((select public.current_app_role()) <> 'client');

grant select, insert, update, delete on public.project_locations to authenticated;
grant select, insert, update, delete on public.file_task_links  to authenticated;

commit;
