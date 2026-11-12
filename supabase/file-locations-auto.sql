-- Drawings › By floor folders (2026-11-12). Additive; safe to re-run.
--  1. ensure_project_location(): find-or-create one floor/room/wall.
--  2. Trigger on tasks: a task saved with a Floor Level / Room Type creates
--     that floor (and room, with the standard walls) automatically — nobody
--     has to create or edit folders by hand.
--  3. Backfill from existing live tasks.
--  4. Starter folders for every project (same list as Files › Site Photos).
--  5. Departments from the sketch that ROAST @ Kokapet was missing.

begin;

-- Building order for floors (unknown names go after these).
create or replace function public.floor_sort_order(p_name text)
returns int
language sql
immutable
as $$
  select case lower(btrim(p_name))
    when 'basement' then 1 when 'foundation' then 2 when 'ground floor' then 3
    when 'mezzanine floor' then 4 when 'first floor' then 5 when 'second floor' then 6
    when 'third floor' then 7 when 'terrace' then 9 when 'roof/terrace' then 9
    else 8 end;
$$;

create or replace function public.ensure_project_location(p_project uuid, p_parent uuid, p_level text, p_name text, p_sort int default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := btrim(p_name);
begin
  if v_name is null or v_name = '' then return null; end if;
  select id into v_id from public.project_locations
   where project_id = p_project
     and coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_parent, '00000000-0000-0000-0000-000000000000'::uuid)
     and lower(btrim(name)) = lower(v_name);
  if v_id is not null then return v_id; end if;
  insert into public.project_locations (project_id, parent_id, level, name, sort_order)
  values (p_project, p_parent, p_level, v_name, p_sort)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then -- lost a race; read the winner
    select id into v_id from public.project_locations
     where project_id = p_project
       and coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_parent, '00000000-0000-0000-0000-000000000000'::uuid)
       and lower(btrim(name)) = lower(v_name);
  end if;
  return v_id;
end;
$$;

-- Room + the standard walls (same set as Site Photos).
create or replace function public.ensure_project_room(p_project uuid, p_floor uuid, p_room text, p_sort int default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
  w text;
  i int := 0;
begin
  v_room := public.ensure_project_location(p_project, p_floor, 'room', p_room, p_sort);
  if v_room is null then return null; end if;
  foreach w in array array['North Wall', 'South Wall', 'East Wall', 'West Wall', 'Ceiling', 'Floor'] loop
    i := i + 1;
    perform public.ensure_project_location(p_project, v_room, 'wall', w, i);
  end loop;
  return v_room;
end;
$$;

revoke all on function public.ensure_project_location(uuid, uuid, text, text, int) from public, anon;
revoke all on function public.ensure_project_room(uuid, uuid, text, int) from public, anon;

-- Task saved with a floor / room -> folders exist.
create or replace function public.tasks_ensure_locations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_floor uuid;
begin
  if new.deleted_at is not null or new.floor_level is null or btrim(new.floor_level) = '' then return new; end if;
  select project_id into v_project from public.works where id = new.work_id;
  if v_project is null then return new; end if;
  v_floor := public.ensure_project_location(v_project, null, 'floor', new.floor_level, public.floor_sort_order(new.floor_level));
  if new.room_type is not null and btrim(new.room_type) <> '' and v_floor is not null then
    perform public.ensure_project_room(v_project, v_floor, new.room_type, 50);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_ensure_locations on public.tasks;
create trigger trg_tasks_ensure_locations
  after insert or update of floor_level, room_type, work_id on public.tasks
  for each row execute function public.tasks_ensure_locations();

-- Backfill from existing live tasks.
do $$
declare
  r record;
  v_floor uuid;
begin
  for r in
    select distinct w.project_id, btrim(t.floor_level) floor_level, nullif(btrim(coalesce(t.room_type, '')), '') room_type
      from public.tasks t join public.works w on w.id = t.work_id
     where t.deleted_at is null and w.project_id is not null and btrim(coalesce(t.floor_level, '')) <> ''
  loop
    v_floor := public.ensure_project_location(r.project_id, null, 'floor', r.floor_level, public.floor_sort_order(r.floor_level));
    if r.room_type is not null then perform public.ensure_project_room(r.project_id, v_floor, r.room_type, 50); end if;
  end loop;
end $$;

-- Starter folders for every project (Site Photos list).
do $$
declare
  p record;
  f record;
  v_floor uuid;
  rm text;
  i int;
begin
  for p in select id from public.projects loop
    for f in
      select * from (values
        ('Foundation',   array['Footings', 'Plinth Beam', 'Grade Slab']),
        ('Ground Floor', array['Living Hall', 'Kitchen', 'Bedroom 1', 'Bathroom 1', 'Staircase', 'Parking']),
        ('First Floor',  array['Bedroom 2', 'Bedroom 3', 'Bathroom 2', 'Balcony', 'Staircase']),
        ('Second Floor', array['Bedroom 4', 'Study', 'Bathroom 3', 'Utility', 'Staircase']),
        ('Terrace',      array['Parapet', 'Water Tank', 'Open Terrace'])
      ) as t(floor, rooms)
    loop
      v_floor := public.ensure_project_location(p.id, null, 'floor', f.floor, public.floor_sort_order(f.floor));
      i := 0;
      foreach rm in array f.rooms loop
        i := i + 1;
        perform public.ensure_project_room(p.id, v_floor, rm, i);
      end loop;
    end loop;
  end loop;
end $$;

-- Departments from the sketch missing in ROAST @ Kokapet.
insert into public.works (id, project_id, name, code, color, created_at, updated_at)
select gen_random_uuid(), p.id, d.name, d.code, d.color, now(), now()
from public.projects p
cross join (values ('Structural', 'STRUCTUR', '#0EA5E9'),
                   ('Networking', 'NETWORKI', '#8B5CF6'),
                   ('Automation', 'AUTOMATI', '#EC4899')) as d(name, code, color)
where p.name = 'ROAST @ Kokapet'
  and not exists (select 1 from public.works w where w.project_id = p.id and lower(w.name) = lower(d.name))
  and not exists (select 1 from public.works w where w.code = d.code);

commit;
