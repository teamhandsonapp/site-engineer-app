-- Closed testing (2026-11-21, client): which testers used the phone app each
-- day, and a 7 PM IST summary to admins. Additive only.
--
-- Testers = active accounts with an @testerpmc.com email.
-- "Used" = the Android / iPhone app sent its heartbeat that day (it does on
-- every open, every return to the app, and every 5 minutes while open —
-- lib/deviceActivity.ts). Filled by a trigger on user_devices, so phones
-- need no new build. Web use is not counted.

-- 1 ── Daily activity ────────────────────────────────────────────────────
create table if not exists public.user_daily_activity (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  day date not null,                      -- IST date
  device_id text not null,
  platform text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, day, device_id)
);
create index if not exists user_daily_activity_day_idx on public.user_daily_activity (day desc);
alter table public.user_daily_activity enable row level security;
drop policy if exists "user_daily_activity readable by admin or self" on public.user_daily_activity;
create policy "user_daily_activity readable by admin or self" on public.user_daily_activity
  for select to authenticated
  using (current_app_role() in ('admin', 'manager') or user_id = current_profile_id());
grant select on public.user_daily_activity to authenticated;

-- Never lets a failure here break the heartbeat itself.
create or replace function public.record_daily_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.platform in ('android', 'ios') then
    begin
      insert into user_daily_activity (user_id, day, device_id, platform, first_seen, last_seen)
      values (new.user_id, (new.last_seen_at at time zone 'Asia/Kolkata')::date, new.device_id, new.platform, new.last_seen_at, new.last_seen_at)
      on conflict (user_id, day, device_id) do update
        set last_seen = greatest(user_daily_activity.last_seen, excluded.last_seen),
            first_seen = least(user_daily_activity.first_seen, excluded.first_seen);
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists user_devices_daily_activity on public.user_devices;
create trigger user_devices_daily_activity
  after insert or update of last_seen_at on public.user_devices
  for each row execute function public.record_daily_activity();

-- 2 ── Admin switches ────────────────────────────────────────────────────
create table if not exists public.app_flags (
  key text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;
drop policy if exists "app_flags readable by admin" on public.app_flags;
create policy "app_flags readable by admin" on public.app_flags
  for select to authenticated using (current_app_role() = 'admin');
drop policy if exists "app_flags updatable by admin" on public.app_flags;
create policy "app_flags updatable by admin" on public.app_flags
  for update to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
grant select, update (enabled, updated_at) on public.app_flags to authenticated;
insert into public.app_flags (key, enabled) values ('tester_daily_summary', true) on conflict (key) do nothing;

-- 3 ── 7 PM IST summary to admins ────────────────────────────────────────
-- "Today: 9 of 12 testers used the app. Not yet: Ravi, Priya, Anil."
create or replace function public.notify_tester_daily_summary() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_key text;
  v_total int;
  v_used int;
  v_missing text;
  v_body text;
  v_tokens text[];
begin
  if not coalesce((select enabled from app_flags where key = 'tester_daily_summary'), false) then
    return;
  end if;

  select count(*),
         count(*) filter (where exists (select 1 from user_daily_activity a where a.user_id = p.id and a.day = v_today)),
         string_agg(p.full_name, ', ' order by p.full_name)
           filter (where not exists (select 1 from user_daily_activity a where a.user_id = p.id and a.day = v_today))
    into v_total, v_used, v_missing
  from user_profiles p
  where p.deleted_at is null and p.status = 'active' and lower(p.email) like '%@testerpmc.com';

  if v_total = 0 then
    return;
  end if;
  v_body := format('Today: %s of %s tester%s used the app.', v_used, v_total, case when v_total = 1 then '' else 's' end)
         || case when v_missing is not null then ' Not yet: ' || v_missing || '.' else ' Everyone used it 🎉' end;

  select array_agg(distinct expo_push_token) into v_tokens
  from user_profiles
  where role::text = 'admin' and deleted_at is null and status = 'active' and expo_push_token is not null;
  if coalesce(array_length(v_tokens, 1), 0) = 0 then
    return;
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_edge_function_key';
  if v_key is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://rkccoznjdexlgvzqkhgg.supabase.co/functions/v1/send-zone-alert',
    body := jsonb_build_object(
      'pushTokens', to_jsonb(v_tokens),
      'emails', to_jsonb(array[]::text[]),
      'title', 'Testers today',
      'body', v_body,
      'data', jsonb_build_object('screen', 'home', 'kind', 'tester-summary')
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 5000
  );

  insert into push_broadcast_log (sent_by, audience, title, body, recipients, is_test, note)
  values (null, 'admins', 'Testers today', v_body, array_length(v_tokens, 1), false, 'daily 7 PM summary');
end;
$$;
revoke all on function public.notify_tester_daily_summary() from public;

-- 13:30 UTC = 7:00 PM IST, every day.
select cron.unschedule(jobid) from cron.job where jobname = 'tester-daily-summary';
select cron.schedule('tester-daily-summary', '30 13 * * *', 'select public.notify_tester_daily_summary();');
