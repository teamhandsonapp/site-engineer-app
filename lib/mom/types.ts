// MoM (Minutes of Meeting) section — shared types for its three tabs:
// Meeting, Reports and Custom Alerts. Stored on this device for now (see
// store.ts); the shapes are kept flat so they can move to Supabase tables
// later without changing the screens.

import type { ContactCategory } from '../contacts';

export type SendChannel = 'whatsapp' | 'email';

// Someone invited to a meeting or receiving a report — always picked from
// the Contact Book (admin's address book) or the project's Specific Book.
export interface Recipient {
  key: string; // `${source}:${id}` — unique across both books
  source: 'contact' | 'project';
  name: string;
  phone: string | null;
  email: string | null;
  category: ContactCategory;
  company: string | null;
}

export type AttendanceMark = 'present' | 'absent';

// One person's agenda points. `from` is a Recipient.key, or 'admin' for the
// organiser's own points.
export interface AgendaSubmission {
  from: string;
  fromName: string;
  points: string[];
  receivedAtISO: string;
}

export interface MeetingRecording {
  id: string;
  uri: string;
  durationMillis: number;
  createdAtISO: string;
  // Filled in once the Transcribe feature is set up.
  transcript: string | null;
}

export interface SendLogEntry {
  channel: SendChannel;
  // WhatsApp only: 'api' = sent by the Meta Cloud API test number,
  // missing/'link' = opened a wa.me chat for the person to press Send.
  via?: 'api' | 'link';
  what: 'invite' | 'agenda-request' | 'final-agenda';
  recipientKeys: string[];
  atISO: string;
}

// Something to discuss in a meeting: a Flowchart task (picked by department)
// or a free-text topic. Shaped like a future Supabase row
// (meeting_discussion_items: id, meeting_id, sort_order, type, task_id,
// department_id, title, discussed, note) so the move later is a 1:1 copy.
export const AGENDA_MAX = 1000;
export const TOPIC_MAX = 200;

export interface DiscussionItem {
  id: string;
  type: 'task' | 'topic';
  taskId: string | null; // tasks.id — task items only
  taskCode: string | null; // e.g. CIVIL-790684 (copy)
  departmentId: string | null; // works.id — task items only
  departmentName: string | null; // copy, so it still shows if renamed/deleted
  title: string; // task name (copy) or the topic text
  // Filled in while writing the minutes (Record tab).
  discussed?: boolean;
  note?: string;
}

export interface Meeting {
  id: string;
  // Added 2026-11-13. Optional: meetings saved before have neither and still open.
  agenda?: string;
  discussionItems?: DiscussionItem[];
  projectId: string;
  title: string;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:MM', 24h, IST
  durationMinutes: number;
  venue: string; // offline meeting — where people meet
  notes: string;
  invitees: Recipient[];
  createdById: string | null;
  createdByName: string | null;
  createdAtISO: string;
  calendarAddedAtISO: string | null;
  sendLog: SendLogEntry[];
  attendance: Record<string, AttendanceMark>; // Recipient.key -> mark
  attendanceSavedAtISO: string | null;
  agendaSubmissions: AgendaSubmission[];
  finalAgenda: string[];
  finalAgendaSentAtISO: string | null;
  recordings: MeetingRecording[];
}

export type ReportType = 'project_health' | 'task_status' | 'pending_upcoming';

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  project_health: 'Project Health Report',
  task_status: 'Task Based Report',
  pending_upcoming: 'Pending & Upcoming Tasks',
};

export type ReportFrequency = 'weekly' | 'monthly';

// An automated report the admin has set up. UI only for now — nothing sends
// on its own until a server-side sender is connected (see ReportsTab).
export interface ReportSchedule {
  id: string;
  projectId: string;
  reportType: ReportType;
  frequency: ReportFrequency;
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday (weekly)
  dayOfMonth: number; // 1-28 (monthly)
  time: string; // 'HH:MM'
  channel: SendChannel;
  recipients: Recipient[];
  active: boolean;
  createdAtISO: string;
}

export interface ReportHistoryEntry {
  id: string;
  projectId: string;
  kind: 'automated' | 'manual' | 'task-list' | 'alert';
  title: string;
  channel: SendChannel | 'pdf' | 'notification';
  recipientNames: string[];
  sentAtISO: string;
}

export interface MomProjectData {
  meetings: Meeting[];
  schedules: ReportSchedule[];
  history: ReportHistoryEntry[];
}
