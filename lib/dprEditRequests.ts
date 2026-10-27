import { supabase } from './supabase';
import { sendCriticalAlertMessage } from './criticalAlertMessages';

export type DprEditRequestStatus = 'pending' | 'approved' | 'denied';

export interface DprEditRequest {
  id: string;
  taskId: string;
  taskCode: string;
  taskName: string;
  reportDate: string;
  requestedByName: string;
  message: string | null;
  status: DprEditRequestStatus;
  createdAtISO: string;
}

// "Contact Admin" — a site engineer's own request to unlock a (task, day)
// DPR that's already locked (dpr_entries.submitted_at set). Two writes:
// the trackable request/approval record itself, plus a real-time push
// straight to admin/manager reusing the EXISTING critical_alert_messages
// pipeline (recipientId null = broadcast, same as every other
// engineer -> admin alert in this app) — no second delivery mechanism
// built for this.
export async function requestDprEditAccess(
  taskId: string,
  reportDate: string,
  projectId: string,
  requestedBy: string,
  taskLabel: string,
  message: string
): Promise<void> {
  const trimmed = message.trim();
  const { error } = await supabase.from('dpr_edit_requests').insert({
    task_id: taskId,
    report_date: reportDate,
    project_id: projectId,
    requested_by: requestedBy,
    message: trimmed || null,
  });
  if (error) throw new Error(error.message);

  await sendCriticalAlertMessage(
    projectId,
    null,
    `Requesting edit access for ${taskLabel}'s ${reportDate} DPR.${trimmed ? ` "${trimmed}"` : ''}`,
    requestedBy
  );
}

// Whether THIS user already has an approved request for this exact (task,
// day) — MVP simplification, by explicit scope: approval permanently lifts
// the lock for that one day (no re-locking, no single-use "consumption").
export async function hasApprovedEditGrant(taskId: string, reportDate: string, requestedBy: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('dpr_edit_requests')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId)
    .eq('report_date', reportDate)
    .eq('requested_by', requestedBy)
    .eq('status', 'approved');
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

// Bulk version of the above — one query for every task on today's DPR
// screen instead of one per row.
export async function fetchApprovedGrantsForToday(
  taskIds: string[],
  todayKey: string,
  requestedBy: string
): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('dpr_edit_requests')
    .select('task_id')
    .in('task_id', taskIds)
    .eq('report_date', todayKey)
    .eq('requested_by', requestedBy)
    .eq('status', 'approved');
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.task_id as string));
}

interface RawEditRequestRow {
  id: string;
  task_id: string;
  report_date: string;
  message: string | null;
  status: DprEditRequestStatus;
  created_at: string;
  requested_by: string;
  task: { task_id: string; task_name: string } | { task_id: string; task_name: string }[] | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

// Admin/manager's own review list — every pending request project-wide,
// newest first. Requester name resolved separately (same batched-lookup
// pattern as fetchTodayDprEntries's own submittedByName).
export async function fetchPendingEditRequests(projectId: string): Promise<DprEditRequest[]> {
  const { data, error } = await supabase
    .from('dpr_edit_requests')
    .select('id, task_id, report_date, message, status, created_at, requested_by, task:tasks(task_id, task_name)')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RawEditRequestRow[];

  const requesterIds = [...new Set(rows.map((r) => r.requested_by))];
  const nameById = new Map<string, string>();
  if (requesterIds.length > 0) {
    const { data: profiles } = await supabase.from('user_profiles').select('id, full_name').in('id', requesterIds);
    for (const p of (profiles ?? []) as { id: string; full_name: string }[]) nameById.set(p.id, p.full_name);
  }

  return rows.map((row) => {
    const task = normalizeToOne(row.task);
    return {
      id: row.id,
      taskId: row.task_id,
      taskCode: task?.task_id ?? '—',
      taskName: task?.task_name ?? 'Unknown task',
      reportDate: row.report_date,
      requestedByName: nameById.get(row.requested_by) ?? 'Unknown user',
      message: row.message,
      status: row.status,
      createdAtISO: row.created_at,
    };
  });
}

export async function reviewEditRequest(id: string, status: 'approved' | 'denied', reviewedBy: string): Promise<void> {
  const { error } = await supabase
    .from('dpr_edit_requests')
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
