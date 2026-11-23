-- Files › R2 (2026-11-11). Project files live in the private Cloudflare R2
-- bucket; the database only keeps their metadata and hands out short-lived
-- signed links. The R2 keys are in Supabase Vault (r2_account_id,
-- r2_access_key_id, r2_secret_access_key, r2_bucket) — never in the app.
--
--   public.project_files          one row per uploaded file (metadata + r2_key)
--   public.r2_upload_url(...)      -> { key, url }  5-min PUT link (staff only)
--   public.r2_file_url(file_id)    -> url           5-min GET link (staff, or the
--                                                    project's own client)
--
-- R2 layout: projects/<project-slug>--<id8>/files/<folder>/<yyyy-mm>/<id8>-<name>

begin;

create schema if not exists r2_private;
revoke all on schema r2_private from public, anon, authenticated;

-- RFC 3986 percent-encoding (AWS SigV4 rules). keep_slash keeps '/' as-is.
create or replace function r2_private.uri_encode(p_text text, p_keep_slash boolean)
returns text
language plpgsql
immutable
as $$
declare
  b bytea := convert_to(p_text, 'UTF8');
  out text := '';
  i int;
  ch int;
begin
  for i in 0 .. length(b) - 1 loop
    ch := get_byte(b, i);
    if (ch between 48 and 57) or (ch between 65 and 90) or (ch between 97 and 122)
       or ch in (45, 46, 95, 126) or (p_keep_slash and ch = 47) then
      out := out || chr(ch);
    else
      out := out || '%' || upper(lpad(to_hex(ch), 2, '0'));
    end if;
  end loop;
  return out;
end;
$$;

create or replace function r2_private.secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

-- AWS SigV4 query-string presign for R2 (region "auto", UNSIGNED-PAYLOAD).
create or replace function r2_private.presign(p_method text, p_key text, p_expires int)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account text := r2_private.secret('r2_account_id');
  v_access  text := r2_private.secret('r2_access_key_id');
  v_secret  text := r2_private.secret('r2_secret_access_key');
  v_bucket  text := r2_private.secret('r2_bucket');
  v_now     timestamp := (now() at time zone 'utc');
  v_amz     text := to_char(v_now, 'YYYYMMDD"T"HH24MISS"Z"');
  v_date    text := to_char(v_now, 'YYYYMMDD');
  v_host    text;
  v_uri     text;
  v_scope   text;
  v_qs      text;
  v_creq    text;
  v_sts     text;
  k         bytea;
begin
  if v_account is null or v_access is null or v_secret is null or v_bucket is null then
    raise exception 'R2 is not configured';
  end if;
  v_host  := v_account || '.r2.cloudflarestorage.com';
  v_uri   := '/' || v_bucket || '/' || r2_private.uri_encode(p_key, true);
  v_scope := v_date || '/auto/s3/aws4_request';
  v_qs := 'X-Amz-Algorithm=AWS4-HMAC-SHA256'
       || '&X-Amz-Credential=' || r2_private.uri_encode(v_access || '/' || v_scope, false)
       || '&X-Amz-Date=' || v_amz
       || '&X-Amz-Expires=' || p_expires
       || '&X-Amz-SignedHeaders=host';
  v_creq := p_method || E'\n' || v_uri || E'\n' || v_qs || E'\n'
         || 'host:' || v_host || E'\n' || E'\n' || 'host' || E'\n' || 'UNSIGNED-PAYLOAD';
  v_sts := 'AWS4-HMAC-SHA256' || E'\n' || v_amz || E'\n' || v_scope || E'\n'
        || encode(extensions.digest(convert_to(v_creq, 'UTF8'), 'sha256'), 'hex');
  k := extensions.hmac(convert_to(v_date, 'UTF8'), convert_to('AWS4' || v_secret, 'UTF8'), 'sha256');
  k := extensions.hmac(convert_to('auto', 'UTF8'), k, 'sha256');
  k := extensions.hmac(convert_to('s3', 'UTF8'), k, 'sha256');
  k := extensions.hmac(convert_to('aws4_request', 'UTF8'), k, 'sha256');
  return 'https://' || v_host || v_uri || '?' || v_qs
      || '&X-Amz-Signature=' || encode(extensions.hmac(convert_to(v_sts, 'UTF8'), k, 'sha256'), 'hex');
end;
$$;

revoke all on all functions in schema r2_private from public, anon, authenticated;

create table if not exists public.project_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  folder       text not null,
  name         text not null,
  mime_type    text,
  size_bytes   bigint,
  r2_key       text not null unique,
  floor        text,
  room         text,
  wall         text,
  department   text,
  uploaded_by  uuid,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists project_files_project_folder_idx on public.project_files(project_id, folder) where deleted_at is null;

alter table public.project_files enable row level security;
drop policy if exists "project_files read" on public.project_files;
create policy "project_files read" on public.project_files for select to authenticated
  using (current_app_role() <> 'client' or project_id = current_client_project_id());
drop policy if exists "project_files write" on public.project_files;
create policy "project_files write" on public.project_files for all to authenticated
  using (current_app_role() <> 'client') with check (current_app_role() <> 'client');
grant select, insert, update, delete on public.project_files to authenticated;

-- 5-minute upload link. Staff only. The key is built here, so a caller can
-- only ever write under projects/<this project>/files/<folder>/.
create or replace function public.r2_upload_url(p_project_id uuid, p_folder text, p_file_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_name text;
  v_slug text;
  v_safe text;
  v_key  text;
begin
  if v_role is null or v_role = 'client' then
    raise exception 'Not authorized';
  end if;
  if p_folder !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'Invalid folder';
  end if;
  select name into v_name from projects where id = p_project_id;
  if v_name is null then
    raise exception 'Project not found';
  end if;
  v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_safe := left(trim(both '-' from regexp_replace(coalesce(p_file_name, 'file'), '[^A-Za-z0-9._-]+', '-', 'g')), 120);
  if v_safe = '' then v_safe := 'file'; end if;
  v_key := 'projects/' || v_slug || '--' || left(p_project_id::text, 8)
        || '/files/' || p_folder || '/' || to_char(now(), 'YYYY-MM')
        || '/' || left(gen_random_uuid()::text, 8) || '-' || v_safe;
  return jsonb_build_object('key', v_key, 'url', r2_private.presign('PUT', v_key, 300));
end;
$$;

-- 5-minute download link for one file, if the caller may see it.
create or replace function public.r2_file_url(p_file_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  f record;
begin
  select * into f from project_files where id = p_file_id and deleted_at is null;
  if f is null then
    raise exception 'File not found';
  end if;
  if v_role is null or (v_role = 'client' and f.project_id is distinct from current_client_project_id()) then
    raise exception 'Not authorized';
  end if;
  return r2_private.presign('GET', f.r2_key, 300);
end;
$$;

revoke all on function public.r2_upload_url(uuid, text, text) from public, anon;
revoke all on function public.r2_file_url(uuid) from public, anon;
grant execute on function public.r2_upload_url(uuid, text, text) to authenticated;
grant execute on function public.r2_file_url(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
