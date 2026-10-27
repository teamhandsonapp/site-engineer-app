import { supabase } from './supabase';
import { fetchUnresolvedSiteIssues } from './siteIssues';
import { fetchUnresolvedGeofenceAlerts } from './geofenceAlerts';
import { fetchUnresolvedRestrictedZoneAlerts } from './restrictedZoneAlerts';
import { fetchUnresolvedLocationDisabledAlerts } from './locationDisabledAlerts';
import { fetchUnresolvedAccountLockouts, LOCKOUT_REASON_LABEL } from './accountLockouts';
import { fetchCriticalAlertMessages } from './criticalAlertMessages';

// Cross-project notification center — the single aggregate NotificationBell's
// counts already implicitly represent (it fetches all 5 of these with no
// project filter, see its own loadSharedCounts), just now surfaced as a real
// per-item list instead of only a total count. Every item carries enough to
// deep-link: project id (for setSelectedProjectId before navigating — see
// ProjectContext.tsx) and a `target` route+params, not just a display string.
// attendance_event/daily_update/leave_request/checklist_verification have no
// real fetch source yet (see DUMMY_NOTIFICATIONS below) — added now so the
// full 7-category structure (and the category field every kind maps to) is
// real and complete today, ready for each to get a real fetchX() wired in
// one at a time later, rather than retrofitting the type when that happens.
export type NotificationKind =
  | 'red_zone_entry' | 'boundary_exit' | 'location_disabled' | 'account_lockout' | 'site_issue' | 'critical_alert_message'
  | 'attendance_event' | 'daily_update' | 'leave_request' | 'checklist_verification';

export const KIND_LABEL: Record<NotificationKind, string> = {
  red_zone_entry: 'Restricted zone',
  boundary_exit: 'Boundary exit',
  location_disabled: 'Location off',
  account_lockout: 'Account locked',
  site_issue: 'Site issue',
  critical_alert_message: 'Critical alert',
  attendance_event: 'Attendance',
  daily_update: 'Daily update',
  leave_request: 'Leave',
  checklist_verification: 'Checklist',
};

export const KIND_COLOR: Record<NotificationKind, string> = {
  red_zone_entry: '#DC2626',
  boundary_exit: '#DC2626',
  location_disabled: '#DC2626',
  account_lockout: '#1D4ED8',
  site_issue: '#DC2626',
  // Same rose accent as CriticalAlertMessageRow's own "PERSON ALERT" badge
  // in critical-alerts.tsx — the one PERSON-sent kind here, kept visually
  // distinct from the system-generated red used by every other kind.
  critical_alert_message: '#BE123C',
  attendance_event: '#16A34A',
  daily_update: '#B45309',
  leave_request: '#0D9488',
  checklist_verification: '#7C3AED',
};

// The coarser grouping the notification bell/center tabs on — several
// `kind`s can share one category (e.g. red_zone_entry/boundary_exit/
// account_lockout/site_issue are all 'critical_alerts'). `kind` still
// drives the per-item icon/color/routing; `category` is what the 7 tabs
// filter on.
export type NotificationCategory =
  | 'critical_alerts' | 'location' | 'attendance' | 'daily_updates' | 'leave' | 'tasks' | 'messages';

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  critical_alerts: 'Critical Alerts',
  location: 'Location',
  attendance: 'Attendance',
  daily_updates: 'Daily Updates',
  leave: 'Leave',
  tasks: 'Tasks',
  messages: 'Messages',
};

export const CATEGORIES: NotificationCategory[] = ['critical_alerts', 'location', 'attendance', 'daily_updates', 'leave', 'tasks', 'messages'];

export function categoryForKind(kind: NotificationKind): NotificationCategory {
  switch (kind) {
    case 'red_zone_entry':
    case 'boundary_exit':
    case 'account_lockout':
    case 'site_issue':
      return 'critical_alerts';
    case 'location_disabled':
      return 'location';
    case 'critical_alert_message':
      return 'messages';
    case 'attendance_event':
      return 'attendance';
    case 'daily_update':
      return 'daily_updates';
    case 'leave_request':
      return 'leave';
    case 'checklist_verification':
      return 'tasks';
  }
}

// A real discriminated union (not a plain `{ pathname: string, params:
// Record<string,string> }`) specifically so this satisfies expo-router's
// own generated typed-route type for router.push end-to-end with no cast
// anywhere — this app has experiments.typedRoutes enabled, and its
// generated type correlates EACH route literal with that route's OWN
// specific params shape (e.g. '/team-attendance-detail/[userId]' requires
// a `userId`, '/critical-alerts' doesn't) — a flat `params: Record<string,
// string>` can't satisfy that regardless of how `pathname` is typed. Add a
// new variant here (and to whichever function below builds it) if a new
// notification kind ever needs a different screen.
export type NotificationTarget =
  | { pathname: '/team-attendance-detail/[userId]'; params: { userId: string; fullName: string } }
  | { pathname: '/critical-alerts'; params: Record<string, string> };

// null on the whole NotificationItem.target = no sensible deep link exists
// for this item (a lockout whose user isn't assigned to any project — see
// accountLockouts.ts's own comment on why that can happen).

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  category: NotificationCategory;
  projectId: string | null;
  projectName: string | null;
  title: string;
  detail: string | null;
  atISO: string;
  target: NotificationTarget | null;
}

function engineerTarget(userId: string, userName: string | null): NotificationTarget {
  // Same screen admin already drills into from Team Attendance — see
  // app/team-attendance-detail/[userId].tsx and team-attendance.tsx's own
  // proven call shape (the literal '[userId]' route template, with userId
  // itself passed inside params — NOT a pre-interpolated pathname string;
  // this app has experiments.typedRoutes enabled, and that's the only
  // shape expo-router's typed router actually generates types for). This
  // screen reads selectedProjectId from ProjectContext rather than taking
  // its own projectId param, so the caller MUST call
  // setSelectedProjectId(item.projectId) before pushing here (see
  // handlePress in the screen that renders this list).
  return { pathname: '/team-attendance-detail/[userId]', params: { userId, fullName: userName ?? '' } };
}

// Staff-wide (not admin/manager-only) — same convention as NotificationBell/
// critical-alerts.tsx, which every staff role already sees (RLS narrows
// account_lockouts to admin/manager on its own, same as before).
// currentUserId/isAdminOrManager are only needed for the critical-alert-
// message loop below (every other kind here is role-agnostic — RLS alone
// decides what a fetchUnresolved* call returns) — a person-sent message is
// the one kind that needs to know WHO's looking, so it never shows a
// viewer their own outgoing message as if it were an incoming alert.
export async function fetchAllNotifications(currentUserId: string, isAdminOrManager: boolean): Promise<NotificationItem[]> {
  const [siteIssues, geofenceAlerts, zoneAlerts, locationAlerts, lockouts, messages, projectsRes] = await Promise.all([
    fetchUnresolvedSiteIssues(),
    fetchUnresolvedGeofenceAlerts(),
    fetchUnresolvedRestrictedZoneAlerts(),
    fetchUnresolvedLocationDisabledAlerts(),
    fetchUnresolvedAccountLockouts(),
    fetchCriticalAlertMessages(),
    supabase.from('projects').select('id, name'),
  ]);
  const projectNameById = new Map<string, string>((projectsRes.data ?? []).map((p) => [p.id as string, p.name as string]));

  const items: NotificationItem[] = [];

  for (const a of zoneAlerts) {
    items.push({
      id: `zone-${a.id}`,
      kind: 'red_zone_entry',
      category: categoryForKind('red_zone_entry'),
      projectId: a.projectId,
      projectName: projectNameById.get(a.projectId) ?? null,
      title: `${a.userName ?? 'A site engineer'} entered ${a.zoneName ?? 'a restricted zone'}`,
      detail: a.exitedAtISO ? 'Left the zone' : 'Still inside',
      atISO: a.enteredAtISO,
      target: engineerTarget(a.userId, a.userName),
    });
  }

  for (const a of geofenceAlerts) {
    items.push({
      id: `geofence-${a.id}`,
      kind: 'boundary_exit',
      category: categoryForKind('boundary_exit'),
      projectId: a.projectId,
      projectName: projectNameById.get(a.projectId) ?? null,
      title: `${a.userName ?? 'A site engineer'} left the site boundary`,
      detail: a.returnedAtISO ? 'Returned' : 'Still outside',
      atISO: a.exitAtISO,
      target: engineerTarget(a.userId, a.userName),
    });
  }

  const LOCATION_REASON_LABEL: Record<string, string> = {
    permission: 'Location permission turned off',
    services: 'Device location services turned off',
    no_fix_timeout: 'No GPS signal for a while',
    background_permission: 'Background location revoked',
    gps_disabled: 'GPS turned off',
    // supabase/tracking-silence-watcher.sql's server-side silence detector
    // — the device stopped reporting entirely (killed background service,
    // force-stop, dead battery, airplane mode — can't tell which, only
    // that it went silent).
    no_heartbeat: 'Stopped reporting — phone likely killed the app',
  };
  for (const a of locationAlerts) {
    items.push({
      id: `locdisabled-${a.id}`,
      kind: 'location_disabled',
      category: categoryForKind('location_disabled'),
      projectId: a.projectId,
      projectName: a.projectId ? projectNameById.get(a.projectId) ?? null : null,
      title: `${a.userName ?? 'A site engineer'} can't be tracked right now`,
      detail: LOCATION_REASON_LABEL[a.reason] ?? a.reason,
      atISO: a.disabledAtISO,
      target: engineerTarget(a.userId, a.userName),
    });
  }

  for (const l of lockouts) {
    items.push({
      id: `lockout-${l.id}`,
      kind: 'account_lockout',
      category: categoryForKind('account_lockout'),
      projectId: l.projectId,
      projectName: l.projectId ? projectNameById.get(l.projectId) ?? null : null,
      title: `${l.userName ?? 'A site engineer'}'s account is locked`,
      detail: LOCKOUT_REASON_LABEL[l.reason] ?? l.reason,
      atISO: l.lockedAtISO,
      // No project to deep-link into if this engineer isn't assigned anywhere.
      target: l.projectId ? engineerTarget(l.userId, l.userName) : null,
    });
  }

  for (const i of siteIssues) {
    items.push({
      id: `issue-${i.id}`,
      kind: 'site_issue',
      category: categoryForKind('site_issue'),
      projectId: i.projectId,
      projectName: projectNameById.get(i.projectId) ?? null,
      title: i.title,
      detail: i.description,
      atISO: i.reportedAtISO,
      // No per-reporter detail screen exists for a site issue (it's a
      // reported problem, not a location/tracking event about one
      // engineer) — Critical Alerts (project-scoped once selectedProjectId
      // is set) is the natural landing spot.
      target: { pathname: '/critical-alerts', params: {} },
    });
  }

  // Only messages the viewer is a plausible RECIPIENT of, and only ones
  // still unacknowledged — a sender's own outgoing message never shows up
  // here as if it were an incoming alert, and once seen it drops out of
  // this "needs attention" list the same way every other kind here does
  // (even though critical-alerts.tsx's own feed keeps it visible, marked
  // "Seen", for the sender's benefit — this notification CENTER is a
  // different, action-oriented view, not a persistent log).
  for (const m of messages) {
    const isRecipient = m.recipientId === currentUserId || (m.recipientId === null && isAdminOrManager);
    if (m.acknowledgedAtISO || m.senderId === currentUserId || !isRecipient) continue;
    items.push({
      id: `critical-msg-${m.id}`,
      kind: 'critical_alert_message',
      category: categoryForKind('critical_alert_message'),
      projectId: m.projectId,
      projectName: m.projectName,
      title: `${m.senderName ?? 'Someone'} sent a critical alert`,
      detail: m.message,
      atISO: m.createdAtISO,
      target: { pathname: '/critical-alerts', params: {} },
    });
  }

  items.sort((a, b) => new Date(b.atISO).getTime() - new Date(a.atISO).getTime());
  return items;
}

// Placeholder — 5 realistic-looking items per category (35 total), so the
// new 7-category notification center's STRUCTURE can be reviewed before
// real data is wired in one category at a time (attendance_event/
// daily_update/leave_request/checklist_verification have no real fetch
// source at all yet — see the NotificationKind comment above; the other
// three kinds already have one, fetchAllNotifications above, but this
// dummy set intentionally stands in for ALL 7 for now rather than mixing
// real+dummy, so the review is consistent). `target: null` throughout —
// none of these point at a real record, so tapping one is a safe no-op
// (NotificationRow already renders "Not linked to a project" for a null
// target).
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export const DUMMY_NOTIFICATIONS: NotificationItem[] = [
  // Critical Alerts
  { id: 'dummy-crit-1', kind: 'red_zone_entry', category: 'critical_alerts', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Kabilan entered Zone A — Basement Excavation', detail: 'Still inside', atISO: hoursAgo(1), target: null },
  { id: 'dummy-crit-2', kind: 'boundary_exit', category: 'critical_alerts', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Prashara left the site boundary', detail: 'Still outside', atISO: hoursAgo(3), target: null },
  { id: 'dummy-crit-3', kind: 'account_lockout', category: 'critical_alerts', projectId: null, projectName: 'ROAST @ Kokapet', title: "Ravi Kumar's account is locked", detail: 'GPS turned off for too long', atISO: hoursAgo(6), target: null },
  { id: 'dummy-crit-4', kind: 'site_issue', category: 'critical_alerts', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Water leakage reported near basement slab', detail: 'Reported by Suresh Menon', atISO: hoursAgo(20), target: null },
  { id: 'dummy-crit-5', kind: 'red_zone_entry', category: 'critical_alerts', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Suresh Menon entered Zone B — Crane Operation Area', detail: 'Returned after 4 minutes', atISO: hoursAgo(30), target: null },

  // Location
  { id: 'dummy-loc-1', kind: 'location_disabled', category: 'location', projectId: null, projectName: 'ROAST @ Kokapet', title: "Anil Nair can't be tracked right now", detail: 'GPS turned off', atISO: hoursAgo(2), target: null },
  { id: 'dummy-loc-2', kind: 'location_disabled', category: 'location', projectId: null, projectName: 'ROAST @ Kokapet', title: "Deepak Pillai can't be tracked right now", detail: 'Location permission turned off', atISO: hoursAgo(5), target: null },
  { id: 'dummy-loc-3', kind: 'location_disabled', category: 'location', projectId: null, projectName: 'ROAST @ Kokapet', title: "Kiran Rao can't be tracked right now", detail: 'No GPS signal for a while', atISO: hoursAgo(9), target: null },
  { id: 'dummy-loc-4', kind: 'location_disabled', category: 'location', projectId: null, projectName: 'ROAST @ Kokapet', title: "Manoj Varma can't be tracked right now", detail: 'Background location revoked', atISO: hoursAgo(14), target: null },
  { id: 'dummy-loc-5', kind: 'location_disabled', category: 'location', projectId: null, projectName: 'ROAST @ Kokapet', title: "Sunil Kumar can't be tracked right now", detail: 'Stopped reporting — phone likely killed the app', atISO: hoursAgo(26), target: null },

  // Attendance
  { id: 'dummy-att-1', kind: 'attendance_event', category: 'attendance', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Kabilan checked in at 9:02 AM', detail: null, atISO: hoursAgo(4), target: null },
  { id: 'dummy-att-2', kind: 'attendance_event', category: 'attendance', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Prashara checked out at 6:15 PM', detail: null, atISO: hoursAgo(8), target: null },
  { id: 'dummy-att-3', kind: 'attendance_event', category: 'attendance', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Ravi Shankar checked in at 8:47 AM', detail: null, atISO: hoursAgo(12), target: null },
  { id: 'dummy-att-4', kind: 'attendance_event', category: 'attendance', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Suresh Babu checked in late — 10:12 AM', detail: null, atISO: hoursAgo(18), target: null },
  { id: 'dummy-att-5', kind: 'attendance_event', category: 'attendance', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Vinod Chandran checked out at 5:58 PM', detail: null, atISO: hoursAgo(28), target: null },

  // Daily Progress Report — one submission per task per day now, not 3
  // fixed time slots (see lib/dprEntries.ts) — this flavor text updated to
  // match, so this category doesn't keep advertising a flow that no longer
  // exists.
  { id: 'dummy-dpr-1', kind: 'daily_update', category: 'daily_updates', projectId: null, projectName: 'ROAST @ Kokapet', title: "Ashok Kutty submitted today's DPR", detail: null, atISO: hoursAgo(5), target: null },
  { id: 'dummy-dpr-2', kind: 'daily_update', category: 'daily_updates', projectId: null, projectName: 'ROAST @ Kokapet', title: "Reminder: today's DPR is still pending", detail: null, atISO: hoursAgo(7), target: null },
  { id: 'dummy-dpr-3', kind: 'daily_update', category: 'daily_updates', projectId: null, projectName: 'ROAST @ Kokapet', title: "Girish Bhat submitted today's DPR", detail: null, atISO: hoursAgo(11), target: null },
  { id: 'dummy-dpr-4', kind: 'daily_update', category: 'daily_updates', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Missed DPR submission', detail: 'Naveen Shetty', atISO: hoursAgo(24), target: null },
  { id: 'dummy-dpr-5', kind: 'daily_update', category: 'daily_updates', projectId: null, projectName: 'ROAST @ Kokapet', title: "Mahesh Achari submitted today's DPR", detail: null, atISO: hoursAgo(31), target: null },

  // Leave
  { id: 'dummy-leave-1', kind: 'leave_request', category: 'leave', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Prashuramu requested leave — Material pickup', detail: null, atISO: hoursAgo(3), target: null },
  { id: 'dummy-leave-2', kind: 'leave_request', category: 'leave', projectId: null, projectName: 'ROAST @ Kokapet', title: "Girish Bhat's leave request approved", detail: null, atISO: hoursAgo(10), target: null },
  { id: 'dummy-leave-3', kind: 'leave_request', category: 'leave', projectId: null, projectName: 'ROAST @ Kokapet', title: "Naveen Shetty's leave request declined", detail: 'Reason: coverage unavailable', atISO: hoursAgo(16), target: null },
  { id: 'dummy-leave-4', kind: 'leave_request', category: 'leave', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Sanjay Poduval requested leave — Client visit', detail: null, atISO: hoursAgo(22), target: null },
  { id: 'dummy-leave-5', kind: 'leave_request', category: 'leave', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Rajesh Kannan returned from leave', detail: null, atISO: hoursAgo(33), target: null },

  // Tasks
  { id: 'dummy-task-1', kind: 'checklist_verification', category: 'tasks', projectId: null, projectName: 'ROAST @ Kokapet', title: 'HVAC Ductwork Installation — checklist completed', detail: 'Awaiting verification', atISO: hoursAgo(2), target: null },
  { id: 'dummy-task-2', kind: 'checklist_verification', category: 'tasks', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Electrical Conduit Layout — checklist completed', detail: 'Awaiting verification', atISO: hoursAgo(9), target: null },
  { id: 'dummy-task-3', kind: 'checklist_verification', category: 'tasks', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Plumbing Rough-in — checklist completed', detail: 'Awaiting verification', atISO: hoursAgo(15), target: null },
  { id: 'dummy-task-4', kind: 'checklist_verification', category: 'tasks', projectId: null, projectName: 'ROAST @ Kokapet', title: 'False Ceiling Framing — checklist completed', detail: 'Awaiting verification', atISO: hoursAgo(21), target: null },
  { id: 'dummy-task-5', kind: 'checklist_verification', category: 'tasks', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Waterproofing Application — checklist completed', detail: 'Awaiting verification', atISO: hoursAgo(27), target: null },

  // Messages
  { id: 'dummy-msg-1', kind: 'critical_alert_message', category: 'messages', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Admin sent a critical alert', detail: 'Please evacuate Zone C immediately', atISO: hoursAgo(1), target: null },
  { id: 'dummy-msg-2', kind: 'critical_alert_message', category: 'messages', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Kabilan sent a critical alert', detail: 'Crane malfunction near Block B', atISO: hoursAgo(6), target: null },
  { id: 'dummy-msg-3', kind: 'critical_alert_message', category: 'messages', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Admin sent a critical alert', detail: 'Weather warning — secure loose materials', atISO: hoursAgo(13), target: null },
  { id: 'dummy-msg-4', kind: 'critical_alert_message', category: 'messages', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Prashara sent a critical alert', detail: 'Water pipe burst on 3rd floor', atISO: hoursAgo(19), target: null },
  { id: 'dummy-msg-5', kind: 'critical_alert_message', category: 'messages', projectId: null, projectName: 'ROAST @ Kokapet', title: 'Admin sent a critical alert', detail: 'Safety audit scheduled tomorrow', atISO: hoursAgo(25), target: null },
];
DUMMY_NOTIFICATIONS.sort((a, b) => new Date(b.atISO).getTime() - new Date(a.atISO).getTime());
