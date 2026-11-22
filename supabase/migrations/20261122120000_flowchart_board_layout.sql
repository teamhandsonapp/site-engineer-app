-- Move & link on every flowchart (2026-11-22, client).
--
-- Past Tasks and Past Tasks Copy draw a layout worked out in code
-- (lib/flowchart/dateOrder.ts), so a card dragged there can't be saved to
-- tasks.manual_position_x/y: on Past Tasks the cards below are the LIVE
-- Current Status tasks, and that would move them on Current Status too.
-- These two tables keep each board's own changes instead:
--
-- * flowchart_board_positions — where a card was dragged to, per board.
--   Wins over the worked-out position (lib/flowchart/boardLayout.ts).
-- * flowchart_board_links — a link shown or hidden on that board only:
--   'show' = a link made there (always drawn, even across columns);
--   'hide' = a drawn-in column arrow (not a saved link) removed there.
--
-- Undo: drop table public.flowchart_board_links; drop table public.flowchart_board_positions;

create table if not exists public.flowchart_board_positions (
  board text not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  x double precision not null,
  y double precision not null,
  updated_at timestamptz not null default now(),
  primary key (board, task_id)
);

create table if not exists public.flowchart_board_links (
  board text not null,
  from_task_id uuid not null references public.tasks(id) on delete cascade,
  to_task_id uuid not null references public.tasks(id) on delete cascade,
  rule text not null check (rule in ('show', 'hide')),
  updated_at timestamptz not null default now(),
  primary key (board, from_task_id, to_task_id)
);

alter table public.flowchart_board_positions enable row level security;
alter table public.flowchart_board_links enable row level security;

drop policy if exists "flowchart_board_positions readable" on public.flowchart_board_positions;
create policy "flowchart_board_positions readable" on public.flowchart_board_positions
  for select to authenticated using (true);
drop policy if exists "flowchart_board_positions writable by staff" on public.flowchart_board_positions;
create policy "flowchart_board_positions writable by staff" on public.flowchart_board_positions
  for all to authenticated using (current_app_role() <> 'client') with check (current_app_role() <> 'client');

drop policy if exists "flowchart_board_links readable" on public.flowchart_board_links;
create policy "flowchart_board_links readable" on public.flowchart_board_links
  for select to authenticated using (true);
drop policy if exists "flowchart_board_links writable by staff" on public.flowchart_board_links;
create policy "flowchart_board_links writable by staff" on public.flowchart_board_links
  for all to authenticated using (current_app_role() <> 'client') with check (current_app_role() <> 'client');

grant select, insert, update, delete on public.flowchart_board_positions to authenticated;
grant select, insert, update, delete on public.flowchart_board_links to authenticated;
