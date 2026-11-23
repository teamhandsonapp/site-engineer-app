-- Closed testing (2026-11-21, client). Additive only.
--
-- 1. Admins can raise the required app build (app_versions.min_build) from
--    Settings → the app's existing "Update required" screen then blocks
--    older builds until they update. Everyone can still read it, as before.
-- 2. "Remind testers" push from Settings (admin only): testers = active
--    accounts with an @testerpmc.com email. Sent server-side through the same
--    send-zone-alert Edge Function the daily-update reminders already use, so
--    testers' phones need no new build. Max 3 real sends a day; "send to me"
--    tests don't count. Every send is logged.

-- 1 ── Update control ────────────────────────────────────────────────────
drop policy if exists "app_versions updatable by admin" on public.app_versions;
create policy "app_versions updatable by admin" on public.app_versions
  for update to authenticated
  using (current_app_role() = 'admin')
  with check (current_app_role() = 'admin');
grant update (min_build, message, store_url, updated_at) on public.app_versions to authenticated;

-- 2 ── Reminder log ──────────────────────────────────────────────────────
create table if not exists public.push_broadcast_log (
  id uuid primary key default gen_random_uuid(),
  sent_by uuid references public.user_profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  audience text not null,
  title text not null,
  body text not null,
  recipients integer not null default 0,
  is_test boolean not null default false,
  note text
);
alter table public.push_broadcast_log enable row level security;
drop policy if exists "push_broadcast_log readable by admin" on public.push_broadcast_log;
create policy "push_broadcast_log readable by admin" on public.push_broadcast_log
  for select to authenticated using (current_app_role() = 'admin');
grant select on public.push_broadcast_log to authenticated;

-- (Uses the existing public.current_profile_id(): the caller's active profile.)

-- How many testers there are, and how many can get a push (have a token).
create or replace function public.tester_reminder_audience()
returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if current_app_role() <> 'admin' then
    raise exception 'Only admins can send tester reminders';
  end if;
  return (
    select json_build_object(
      'testers', count(*),
      'withToken', count(distinct expo_push_token) filter (where expo_push_token is not null),
      'sentToday', (select count(*) from push_broadcast_log
                    where audience = 'testers' and not is_test
                      and (sent_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)
    )
    from user_profiles
    where deleted_at is null and status = 'active' and lower(email) like '%@testerpmc.com'
  );
end;
$$;

-- Sends the reminder. p_test = true → only to the admin's own phone (not counted in the daily limit).
create or replace function public.send_tester_reminder(p_body text, p_test boolean default false)
returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_me uuid := current_profile_id();
  v_title text := 'PMC Portal';
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_key text;
  v_tokens text[];
  v_sent_today int;
  v_batch text[];
  i int := 1;
begin
  if current_app_role() <> 'admin' then
    raise exception 'Only admins can send tester reminders';
  end if;
  if v_body is null then
    raise exception 'Write a message first';
  end if;
  if length(v_body) > 300 then
    raise exception 'Message is too long (300 characters max)';
  end if;

  select count(*) into v_sent_today from push_broadcast_log
  where audience = 'testers' and not is_test
    and (sent_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date;
  if not p_test and v_sent_today >= 3 then
    raise exception 'Already sent 3 tester reminders today — try again tomorrow';
  end if;

  if p_test then
    select array_agg(expo_push_token) into v_tokens from user_profiles where id = v_me and expo_push_token is not null;
  else
    select array_agg(distinct expo_push_token) into v_tokens from user_profiles
    where deleted_at is null and status = 'active' and lower(email) like '%@testerpmc.com' and expo_push_token is not null;
  end if;
  if coalesce(array_length(v_tokens, 1), 0) = 0 then
    raise exception '%', case when p_test then 'Your account has no phone with notifications on' else 'No tester has notifications turned on yet' end;
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_edge_function_key';
  if v_key is null then
    raise exception 'Push is not set up on the server';
  end if;

  -- Expo takes up to 100 tokens per request.
  while i <= array_length(v_tokens, 1) loop
    v_batch := v_tokens[i : i + 99];
    perform net.http_post(
      url := 'https://rkccoznjdexlgvzqkhgg.supabase.co/functions/v1/send-zone-alert',
      body := jsonb_build_object(
        'pushTokens', to_jsonb(v_batch),
        'emails', to_jsonb(array[]::text[]),
        'title', v_title,
        'body', v_body,
        'data', jsonb_build_object('screen', 'home', 'kind', 'tester-reminder')
      ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 5000
    );
    i := i + 100;
  end loop;

  insert into push_broadcast_log (sent_by, audience, title, body, recipients, is_test)
  values (v_me, 'testers', v_title, v_body, array_length(v_tokens, 1), p_test);

  return json_build_object(
    'sent', array_length(v_tokens, 1),
    'test', p_test,
    'remainingToday', greatest(0, 3 - v_sent_today - case when p_test then 0 else 1 end)
  );
end;
$$;

revoke all on function public.tester_reminder_audience() from public;
revoke all on function public.send_tester_reminder(text, boolean) from public;
grant execute on function public.tester_reminder_audience() to authenticated;
grant execute on function public.send_tester_reminder(text, boolean) to authenticated;
