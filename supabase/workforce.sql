-- Workers Attendance (2026-11-11) — replaces the old demo-only Workforce
-- Attendance screen. Mobile: app/(authenticated)/team-attendance.tsx
-- (folders, people, analytics) and the DPR tab's Workers Attendance section
-- (marks today's attendance for the departments of today's tasks).
--
--   workforce_folders     one folder per department (works row) per project
--   workforce_members     people in a folder: name, identifier, manager|worker
--   workforce_attendance  one row per person per day: present|absent
--
-- Access mirrors tasks: staff (any non-client role) read + write.

begin;

create table if not exists public.workforce_folders (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  work_id     uuid not null references public.works(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (project_id, work_id)
);

create table if not exists public.workforce_members (
  id          uuid primary key default gen_random_uuid(),
  folder_id   uuid not null references public.workforce_folders(id) on delete cascade,
  name        text not null,
  identifier  text,
  role        text not null default 'worker' check (role in ('manager', 'worker')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists workforce_members_folder_idx on public.workforce_members(folder_id);

create table if not exists public.workforce_attendance (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.workforce_members(id) on delete cascade,
  attendance_date  date not null,
  status           text not null check (status in ('present', 'absent')),
  marked_by        uuid,
  marked_at        timestamptz not null default now(),
  unique (member_id, attendance_date)
);
create index if not exists workforce_attendance_date_idx on public.workforce_attendance(attendance_date);

alter table public.workforce_folders    enable row level security;
alter table public.workforce_members    enable row level security;
alter table public.workforce_attendance enable row level security;

do $$
declare t text;
begin
  foreach t in array array['workforce_folders', 'workforce_members', 'workforce_attendance'] loop
    execute format('drop policy if exists "%1$s staff all" on public.%1$I', t);
    execute format(
      'create policy "%1$s staff all" on public.%1$I for all to authenticated
         using (current_app_role() <> ''client'') with check (current_app_role() <> ''client'')', t);
  end loop;
end $$;

grant select, insert, update, delete on public.workforce_folders, public.workforce_members, public.workforce_attendance to authenticated;

-- Seed: ROAST @ Kokapet — folders for the departments of the two live tasks
-- (Civil Works, Plumbing), 5 people each (1 manager + 4 workers).
insert into public.workforce_folders (project_id, work_id)
select w.project_id, w.id
  from public.works w join public.projects p on p.id = w.project_id
 where p.name = 'ROAST @ Kokapet' and w.code in ('CIVIL', 'PLUM')
on conflict (project_id, work_id) do nothing;

insert into public.workforce_members (folder_id, name, identifier, role)
select f.id, m.name, m.identifier, m.role
  from public.workforce_folders f
  join public.works w on w.id = f.work_id
  join (values
    ('CIVIL', 'Raju Yadav',      'CIV-01', 'manager'),
    ('CIVIL', 'Venkatesh M',     'CIV-02', 'worker'),
    ('CIVIL', 'Srinivas Goud',   'CIV-03', 'worker'),
    ('CIVIL', 'Mahesh Kumar',    'CIV-04', 'worker'),
    ('CIVIL', 'Narsimha Rao',    'CIV-05', 'worker'),
    ('PLUM',  'Anand Reddy',     'PLM-01', 'manager'),
    ('PLUM',  'Shiva Prasad',    'PLM-02', 'worker'),
    ('PLUM',  'Ramesh Babu',     'PLM-03', 'worker'),
    ('PLUM',  'Krishna Murthy',  'PLM-04', 'worker'),
    ('PLUM',  'Ravi Teja',       'PLM-05', 'worker')
  ) as m(code, name, identifier, role) on m.code = w.code
 where not exists (select 1 from public.workforce_members x where x.folder_id = f.id and x.identifier = m.identifier);

commit;

notify pgrst, 'reload schema';
