import { supabase } from './supabase';

// Two-way Critical Alert — person-sent messages inside the existing
// Critical Alerts feed (see critical-alerts.tsx). Every other row in that
// feed is system-generated (red zone entry, boundary exit, lockout,
// location off, site issue); these are the first PERSON-sent ones.
export interface CriticalAlertMessage {
  id: string;
  projectId: string;
  projectName: string | null;
  senderId: string;
  senderName: string | null;
  senderRole: string | null;
  // null = broadcast to whichever admin/manager(s) are configured for this
  // project (the engineer -> admin direction) rather than one fixed person
  // — see the migration's own comment on why.
  recipientId: string | null;
  recipientName: string | null;
  message: string;
  acknowledgedAtISO: string | null;
  acknowledgedByName: string | null;
  createdAtISO: string;
}

interface RawCriticalAlertMessageRow {
  id: string;
  project_id: string;
  sender_id: string;
  recipient_id: string | null;
  message: string;
  acknowledged_at: string | null;
  created_at: string;
  project: { name: string } | { name: string }[] | null;
  sender: { full_name: string; role: string } | { full_name: string; role: string }[] | null;
  recipient: { full_name: string } | { full_name: string }[] | null;
  acknowledged_by: { full_name: string } | { full_name: string }[] | null;
}

function oneOrNull<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function toCriticalAlertMessage(row: RawCriticalAlertMessageRow): CriticalAlertMessage {
  const sender = oneOrNull(row.sender);
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: oneOrNull(row.project)?.name ?? null,
    senderId: row.sender_id,
    senderName: sender?.full_name ?? null,
    senderRole: sender?.role ?? null,
    recipientId: row.recipient_id,
    recipientName: oneOrNull(row.recipient)?.full_name ?? null,
    message: row.message,
    acknowledgedAtISO: row.acknowledged_at,
    acknowledgedByName: oneOrNull(row.acknowledged_by)?.full_name ?? null,
    createdAtISO: row.created_at,
  };
}

const SELECT = `
  id, project_id, sender_id, recipient_id, message, acknowledged_at, created_at,
  project:projects(name),
  sender:user_profiles!critical_alert_messages_sender_id_fkey(full_name, role),
  recipient:user_profiles!critical_alert_messages_recipient_id_fkey(full_name),
  acknowledged_by:user_profiles!critical_alert_messages_acknowledged_by_id_fkey(full_name)
`;

// Deliberately NOT unresolved-only, unlike every other Critical Alerts feed
// (siteIssues.ts, geofenceAlerts.ts, etc.) — those purge the instant
// they're resolved, but a person-sent message needs to stay visible to its
// SENDER after acknowledgment too ("so the sender isn't left wondering
// whether their message actually got noticed" — the whole point of the
// ack action), just visually marked as seen instead of disappearing.
// Capped at 50 rather than unbounded — this is a deliberate, low-volume
// human channel (someone typing a message), not an automatic feed that can
// spike to dozens of unresolved rows on a neglected project. RLS already
// narrows this to messages the signed-in account is allowed to see
// (sender, named recipient, or any admin/manager for a broadcast).
export async function fetchCriticalAlertMessages(): Promise<CriticalAlertMessage[]> {
  const { data, error } = await supabase
    .from('critical_alert_messages')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawCriticalAlertMessageRow[]).map(toCriticalAlertMessage);
}

// recipientId null = broadcast to admin/manager on this project (engineer
// -> admin direction) — the server-side notify_critical_alert_message
// function (add-critical-alert-messages.sql) resolves who that actually
// reaches via zone_alert_recipients, same as every other alert type here.
export async function sendCriticalAlertMessage(
  projectId: string,
  recipientId: string | null,
  message: string,
  senderId: string,
  // lib/alarmSounds.ts id; null = the default tone. Stored on the row so
  // the DB trigger can pass it through to the push.
  sound: string | null = null
): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Message cannot be empty');

  const { error } = await supabase.from('critical_alert_messages').insert({
    project_id: projectId,
    sender_id: senderId,
    recipient_id: recipientId,
    message: trimmed,
    ...(sound ? { sound } : {}),
  });
  if (error) throw new Error(error.message);
}

// "Mark as seen" — broad staff UPDATE per the table's own RLS policy, so
// whichever admin/manager actually saw a broadcast message can be the one
// who acknowledges it, not just one fixed recipient.
export async function acknowledgeCriticalAlertMessage(messageId: string, acknowledgedByUserId: string): Promise<void> {
  const { error } = await supabase
    .from('critical_alert_messages')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by_id: acknowledgedByUserId,
    })
    .eq('id', messageId);
  if (error) throw new Error(error.message);
}

export interface ProjectEngineer {
  id: string;
  fullName: string;
}

// The admin/manager compose form's recipient picker — site_engineer/
// senior_site_engineer accounts actually assigned to this project via
// project_users, same batched-join shape team-attendance's own summary
// query already uses (assignment first, then the matching profiles), not
// a per-engineer round trip.
export async function fetchProjectEngineers(projectId: string): Promise<ProjectEngineer[]> {
  const { data: assignments, error: assignError } = await supabase
    .from('project_users')
    .select('user_id')
    .eq('project_id', projectId);
  if (assignError) throw new Error(assignError.message);

  const userIds = (assignments ?? []).map((a) => a.user_id as string);
  if (userIds.length === 0) return [];

  const { data: engineers, error } = await supabase
    .from('user_profiles')
    .select('id, full_name')
    .in('id', userIds)
    .in('role', ['site_engineer', 'senior_site_engineer'])
    .is('deleted_at', null)
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);

  return (engineers ?? []).map((e) => ({ id: e.id as string, fullName: e.full_name as string }));
}

// The field role's blocking popup (components/CriticalAlertPopup.tsx) —
// only messages addressed to this user that nobody has acknowledged yet,
// and only recent ones: an unacknowledged message from weeks ago
// shouldn't ambush someone the first time they open a new build.
export async function fetchMyPendingCriticalAlerts(userId: string, sinceHours = 24): Promise<CriticalAlertMessage[]> {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('critical_alert_messages')
    .select(SELECT)
    .eq('recipient_id', userId)
    .is('acknowledged_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawCriticalAlertMessageRow[]).map(toCriticalAlertMessage);
}
