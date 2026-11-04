import { supabase } from './supabase';

export interface SiteIssue {
  id: string;
  projectId: string;
  title: string;
  description: string;
  reportedById: string | null;
  reportedByName: string | null;
  reportedAtISO: string;
  resolved: boolean;
  resolvedAtISO: string | null;
  resolvedByName: string | null;
}

// Same to-one-embed-may-arrive-as-an-array caveat as dependencyAlerts.ts's
// RawItemRow.completion — no generated Supabase types in this repo, so this
// documents the actual shape PostgREST returns.
interface RawSiteIssueRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  reported_by_id: string | null;
  reported_at: string;
  resolved: boolean;
  resolved_at: string | null;
  reported_by: { full_name: string } | { full_name: string }[] | null;
  resolved_by: { full_name: string } | { full_name: string }[] | null;
}

function oneOrNull<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function toSiteIssue(row: RawSiteIssueRow): SiteIssue {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    reportedById: row.reported_by_id,
    reportedByName: oneOrNull(row.reported_by)?.full_name ?? null,
    reportedAtISO: row.reported_at,
    resolved: row.resolved,
    resolvedAtISO: row.resolved_at,
    resolvedByName: oneOrNull(row.resolved_by)?.full_name ?? null,
  };
}

const SELECT = `
  id, project_id, title, description, reported_by_id, reported_at, resolved, resolved_at,
  reported_by:user_profiles!site_issues_reported_by_id_fkey(full_name),
  resolved_by:user_profiles!site_issues_resolved_by_id_fkey(full_name)
`;

// Staff-only, same convention as fetchAllPendingClientAlerts — RLS already
// restricts this to staff regardless, filtered client-side by the caller's
// selected project like the rest of Critical Alerts' feeds.
export async function fetchUnresolvedSiteIssues(): Promise<SiteIssue[]> {
  const { data, error } = await supabase
    .from('site_issues')
    .select(SELECT)
    .eq('resolved', false)
    .order('reported_at', { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawSiteIssueRow[]).map(toSiteIssue);
}

export async function resolveSiteIssue(issueId: string, resolvedByUserId: string): Promise<void> {
  const { error } = await supabase
    .from('site_issues')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by_id: resolvedByUserId,
    })
    .eq('id', issueId);

  if (error) throw new Error(error.message);
}
