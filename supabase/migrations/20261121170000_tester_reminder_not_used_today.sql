-- Remind testers (2026-11-21, client): option to send only to testers who
-- haven't opened the phone app today (user_daily_activity). Replaces the
-- 2-argument send_tester_reminder added earlier today with a 3-argument one
-- (p_only_missing defaults to false, so existing calls behave the same).

drop function if exists public.send_tester_reminder(text, boolean);

create or replace function public.tester_reminder_audience()
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if current_app_role() <> 'admin' then
    raise exception 'Only admins can send tester reminders';
  end if;
  return (
    select json_build_object(
      'testers', count(*),
      'withToken', count(distinct expo_push_token) filter (where expo_push_token is not null),
      'notUsedToday', count(*) filter (where not exists (select 1 from user_daily_activity a where a.user_id = p.id and a.day = v_today)),
      'notUsedTodayWithToken', count(distinct expo_push_token) filter (
        where expo_push_token is not null and not exists (select 1 from user_daily_activity a where a.user_id = p.id and a.day = v_today)),
      'sentToday', (select count(*) from push_broadcast_log
                    where audience like 'testers%' and not is_test
                      and (sent_at at time zone 'Asia/Kolkata')::date = v_today)
    )
    from user_profiles p
    where p.deleted_at is null and p.status = 'active' and lower(p.email) like '%@testerpmc.com'
  );
end;
$$;

create or replace function public.send_tester_reminder(p_body text, p_test boolean default false, p_only_missing boolean default false)
returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_me uuid := current_profile_id();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
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
  where audience like 'testers%' and not is_test and (sent_at at time zone 'Asia/Kolkata')::date = v_today;
  if not p_test and v_sent_today >= 3 then
    raise exception 'Already sent 3 tester reminders today — try again tomorrow';
  end if;

  if p_test then
    select array_agg(expo_push_token) into v_tokens from user_profiles where id = v_me and expo_push_token is not null;
  else
    select array_agg(distinct p.expo_push_token) into v_tokens from user_profiles p
    where p.deleted_at is null and p.status = 'active' and lower(p.email) like '%@testerpmc.com' and p.expo_push_token is not null
      and (not p_only_missing or not exists (select 1 from user_daily_activity a where a.user_id = p.id and a.day = v_today));
  end if;
  if coalesce(array_length(v_tokens, 1), 0) = 0 then
    raise exception '%', case
      when p_test then 'Your account has no phone with notifications on'
      when p_only_missing then 'Every tester with notifications on has already used the app today'
      else 'No tester has notifications turned on yet' end;
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_edge_function_key';
  if v_key is null then
    raise exception 'Push is not set up on the server';
  end if;

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
  values (v_me, case when p_only_missing then 'testers-not-used-today' else 'testers' end, v_title, v_body, array_length(v_tokens, 1), p_test);

  return json_build_object(
    'sent', array_length(v_tokens, 1),
    'test', p_test,
    'remainingToday', greatest(0, 3 - v_sent_today - case when p_test then 0 else 1 end)
  );
end;
$$;

revoke all on function public.send_tester_reminder(text, boolean, boolean) from public;
grant execute on function public.send_tester_reminder(text, boolean, boolean) to authenticated;
grant execute on function public.tester_reminder_audience() to authenticated;
