-- Flowchart link types (2026-11-13). Additive and safe to re-run.
--
-- task_dependencies already stores the link type in "type" ("DependencyType"
-- enum: FS, SS, FF, SF; default FS — admin-web reads the same column, so the
-- values stay upper-case). Every existing link is FS already; the update
-- below is a no-op safety net.
--
-- Adds:
--   lag_days      optional lag between the two tasks, in days (default 0, no UI yet)
--   no self-links, no reverse duplicates (A->B and B->A), no circular chains
--   (A -> B -> C -> A). The existing unique (task_id, depends_on_task_id)
--   index already blocks exact duplicates.

begin;

alter table public.task_dependencies
  add column if not exists lag_days integer not null default 0;

update public.task_dependencies set type = 'FS' where type is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'task_dependencies_no_self_link') then
    -- NOT VALID: checks every new/changed row without failing on old data.
    alter table public.task_dependencies
      add constraint task_dependencies_no_self_link check (task_id <> depends_on_task_id) not valid;
  end if;
end $$;

-- Arrow direction: depends_on_task_id (A, predecessor) -> task_id (B, successor).
create or replace function public.task_dependencies_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id = new.depends_on_task_id then
    raise exception 'A task can''t be linked to itself.';
  end if;

  if exists (
    select 1 from public.task_dependencies d
    where d.task_id = new.depends_on_task_id and d.depends_on_task_id = new.task_id
      and d.id is distinct from new.id
  ) then
    raise exception 'These two tasks are already linked the other way round.';
  end if;

  -- Circular: following arrows forward from B must never reach A.
  if exists (
    with recursive downstream(id) as (
      select d.task_id from public.task_dependencies d
      where d.depends_on_task_id = new.task_id and d.id is distinct from new.id
      union
      select d.task_id from public.task_dependencies d
      join downstream s on d.depends_on_task_id = s.id
      where d.id is distinct from new.id
    )
    select 1 from downstream where id = new.depends_on_task_id
  ) then
    raise exception 'This link would make a loop (A -> B -> ... -> A).';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_task_dependencies_guard on public.task_dependencies;
create trigger trg_task_dependencies_guard
  before insert or update of task_id, depends_on_task_id on public.task_dependencies
  for each row execute function public.task_dependencies_guard();

commit;
