-- App Progress flowchart (2026-11-18): one row per app feature (F01–F18) and
-- launch step (L1–L3), shown as boxes in PMC Portal → App Progress →
-- Flowchart. Holds what changes over time — the status and the points with
-- their ticks — so everyone sees the same thing. The box positions, names
-- and links stay in the app's code (lib/appFlow.ts).
--
-- status: ready | ongoing | client (needs client input) | todo (pending)
-- points: [{ "text": "...", "kind": "client" | "build" | "test", "done": true|false }]
--   kind: Needed from client / To build / To test

create table if not exists public.app_flow_features (
  id text primary key,
  status text not null default 'ready' check (status in ('ready', 'ongoing', 'client', 'todo')),
  points jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.app_flow_features enable row level security;

-- Every signed-in person can see it; everyone except the client role can tick
-- points (the app shows the status buttons to Admin only).
drop policy if exists "app_flow_features read" on public.app_flow_features;
create policy "app_flow_features read" on public.app_flow_features
  for select to authenticated using (true);

drop policy if exists "app_flow_features write" on public.app_flow_features;
create policy "app_flow_features write" on public.app_flow_features
  for all to authenticated
  using ((select public.current_app_role()) <> 'client')
  with check ((select public.current_app_role()) <> 'client');

-- Starting data. F02 Flowchart, F03 Critical Alerts & Notifications, F05
-- Gantt Chart, F06 DPR and F17 PR are the real lists (19 Nov); the rest is from App Progress (10 Nov) until the
-- real lists come in. Re-running this file never
-- overwrites ticks or statuses already saved.
insert into public.app_flow_features (id, status, points) values
  ('roles', 'client', '[{"text": "List of all people and their role", "kind": "client", "done": false}, {"text": "What each role does", "kind": "client", "done": false}, {"text": "What each role can see", "kind": "client", "done": false}, {"text": "Set up roles in the app", "kind": "build", "done": false}]'),
  ('flow', 'ongoing', '[{"text": "Create task boxes", "kind": "test", "done": false}, {"text": "Link tasks", "kind": "test", "done": false}, {"text": "Move and arrange task boxes", "kind": "test", "done": false}, {"text": "Check the tasks and links in the flowchart", "kind": "test", "done": false}]'),
  ('alerts', 'ongoing', '[{"text": "Notifications arrive on their phones, on site", "kind": "test", "done": false}, {"text": "Critical alerts arrive with sound on their phones, on site", "kind": "test", "done": false}]'),
  ('gantt', 'client', '[{"text": "See and approve the Gantt chart", "kind": "client", "done": false}]'),
  ('dpr', 'client', '[{"text": "Give the DPR format", "kind": "client", "done": false}]'),
  ('pr', 'client', '[{"text": "Give the PR format", "kind": "client", "done": false}]'),
  ('reports', 'client', '[{"text": "Give the report formats and what each report should show", "kind": "client", "done": false}]'),
  ('portal', 'todo', '[{"text": "Set up what the client sees, once everything else is done", "kind": "build", "done": false}]'),
  ('files', 'client', '[{"text": "Give the real drawings for one project (at least 10–15)", "kind": "client", "done": false}, {"text": "Upload the drawings and check the flow", "kind": "test", "done": false}, {"text": "Client tests the drawings flow", "kind": "test", "done": false}]'),
  ('contacts', 'client', '[{"text": "Add-contact format: which details", "kind": "client", "done": false}, {"text": "Check the format with the client", "kind": "test", "done": false}]'),
  ('mom', 'ongoing', '[{"text": "Create a mail ID for the client", "kind": "build", "done": false}, {"text": "Create a mailer and connect it with Gmail", "kind": "build", "done": false}, {"text": "Sync all meeting events with Google Calendar", "kind": "build", "done": false}, {"text": "Set up the Meta WhatsApp integration", "kind": "build", "done": false}, {"text": "Do the Meta business verification", "kind": "build", "done": false}]'),
  ('devices', 'ready', '[]'),
  ('beta', 'ongoing', '[{"text": "11 testers added", "kind": "client", "done": true}, {"text": "Add the 12th tester", "kind": "client", "done": false}, {"text": "14-day closed test (starts once all 12 are in)", "kind": "test", "done": false}]'),
  ('release', 'todo', '[]'),
  ('appstore', 'todo', '[{"text": "Record a screen video on iPhone", "kind": "build", "done": false}, {"text": "Submit the app to the App Store", "kind": "build", "done": false}]'),
  ('workers', 'client', '[{"text": "Give the worker attendance format: how the client will fill it in", "kind": "client", "done": false}]')
on conflict (id) do nothing;
