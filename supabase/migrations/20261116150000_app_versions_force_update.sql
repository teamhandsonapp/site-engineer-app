-- Force update (2026-11-16): the lowest app build allowed per platform.
-- Raise min_build (e.g. to 44) and every phone on an older build is blocked
-- with an "Update now" screen until it installs the new version.
create table if not exists public.app_versions (
  platform text primary key check (platform in ('android', 'ios')),
  min_build integer not null default 0,
  store_url text,
  message text,
  updated_at timestamptz not null default now()
);

alter table public.app_versions enable row level security;

-- Everyone (even before login) can read it; only the dashboard / SQL can change it.
drop policy if exists "app_versions readable by all" on public.app_versions;
create policy "app_versions readable by all" on public.app_versions for select to anon, authenticated using (true);

insert into public.app_versions (platform, min_build) values ('android', 0), ('ios', 0)
on conflict (platform) do nothing;
