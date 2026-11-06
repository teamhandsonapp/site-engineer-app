// App Progress: one entry per app screen — what is done, what is pending,
// and what is needed (and from whom) to finish it. Shown on the App
// Progress screen. Add the next screen as a new entry. Keep every item a
// short name (a few words, one line) — no sentences.

export type ProgressFrom = 'Client' | 'PMC team' | 'Development' | 'Phone update';

export interface ScreenProgress {
  screen: string;
  updated: string; // YYYY-MM-DD
  done: string[];
  pending: string[];
  needed: { item: string; from: ProgressFrom }[];
}

// Every "done" item below was checked on 2026-11-06 against the running app
// and the live database, not just the code:
//   6 groups / auto-hide  — screenshot of Notifications (Location hidden)
//   Live alert bell        — reads site_issues; 0 open = no badge (matches)
//   DPR reminder push      — sent today 12:00 and 15:00 (OK), 17:30 timed out
//   Send critical alerts   — 80 sent, latest 5 Nov
// Things that exist but were NOT proven working are under pending as "Test …".
//
// Home, Template Kit, Files, Access & Roles, Contact Book — checked
// 2026-11-06 (manager + site engineer logins, phone-size screenshots, live DB):
//   Project progress     — ROAST shows 8 of 15 done = 8 completed / 15 in DB
//   Overview counts      — FIXED numbers in code (DB has 12 engineers, shows 22)
//   Engineer sees all 3  — test engineer has 0 assigned projects
//   Link tasks           — link saved today from the app, drawn on canvas
//   Checklists           — AC/AV items load from the shared template table
//   Drawings             — 5 drawings, 11 tags in DB; viewer renders PDF + tags
//   Transmittal/RA/Quotes — hardcoded sample files; uploads not saved
//   Site photos          — 13 bundled samples; 0 DPR photos in DB
//   User list            — 16 users = DB (12 SE, 2 admin, 1 manager, 1 client)
//   Contacts             — 20 in DB, all bulk-added 13 Sep; admin-only rules live
// Create / invite / reset / role change / contact edits were not run (they
// write to live data) and need an admin login — kept as "Test …".
//
// DPR, MoM, Status — checked 2026-11-06:
//   DPR list + form      — engineer login: In Progress tasks, DPR page opens
//   Submit / draft       — 4 real submits (25 Sep, 28 Oct, all by admin), draft 5 Nov
//   Reminder push        — 123 sent, latest today 17:30 IST
//   History / checklist  — fake history rows; sample quality items in code
//   MoM storage          — meetings/schedules/history saved on the phone only
//   MoM invitees         — manager sees "No contacts yet" (Contact Book is
//                          admin-only, Specific Book empty) → can't create
//   Task report PDF      — Preview PDF opened with real ROAST tasks (8/15)
//   Weekly test email    — 4 sent, all accepted (report_email_log)
//   Department alert     — never used (0 rows)
//   Monthly Status (Aug) — TASK-001: 4 DPRs 18/25/25/25 % = DB
//   Architect Status     — 3 tasks, 9 pending inputs = DB
//   Task Based Status    — TASK-001 loads; contractor "Suresh Reddy" is fixed text
//   Site Engineer Status — shows SAMPLE rows when there's no real data
export const APP_PROGRESS: ScreenProgress[] = [
  {
    screen: 'Home',
    updated: '2026-11-06',
    done: ['Greeting & date', 'Project switcher', 'Quick links', 'DPR link for engineers', 'Project progress list'],
    pending: ['Real Overview counts', 'Engineers: only their projects', 'Test client home', 'Test client YES / NO replies'],
    needed: [
      { item: 'Client login for testing', from: 'PMC team' },
      { item: 'Connect Overview counts', from: 'Development' },
    ],
  },
  {
    screen: 'Notifications',
    updated: '2026-11-06',
    done: ['6 notification groups', 'Live alert bell', 'DPR reminder push', 'Send critical alerts', 'Location group auto-hide', 'Testing tools in this tab'],
    pending: [
      'Real data (now sample)',
      'Real alerts & messages',
      'Attendance, DPR, leave, tasks',
      'Tap to open item',
      'Read / unread',
      'Site engineer list',
      'Test checklist & invoice push',
      'Test broadcast push',
      'Test alert pop-up on phone',
      'Push time limit',
      'Broadcast code in repo',
    ],
    needed: [
      { item: 'Who gets which alerts', from: 'Client' },
      { item: 'Site engineer list?', from: 'Client' },
      { item: 'All projects or one', from: 'PMC team' },
      { item: 'OK for read / unread table', from: 'PMC team' },
      { item: 'Phone for push tests', from: 'PMC team' },
      { item: 'Connect real data', from: 'Development' },
      { item: 'New Play Store build', from: 'Phone update' },
    ],
  },
  {
    screen: 'Template Kit',
    updated: '2026-11-06',
    done: ['Template list', 'Tasks on canvas', 'Link tasks', 'Lock / edit mode', 'AC / AV checklists'],
    pending: [
      'Fix link direction on apply',
      'Lag / lead days',
      'Working days on apply',
      'Keep AC / AV on apply',
      'Block loop links',
      'Undo for new task & sheet',
      'Test create template',
      'Test upload sheet',
      'Test apply to project',
      'Test checklist edits',
    ],
    needed: [
      { item: 'OK for lag / lead change', from: 'PMC team' },
      { item: 'Fix apply issues', from: 'Development' },
      { item: 'New Play Store build', from: 'Phone update' },
    ],
  },
  {
    screen: 'Files',
    updated: '2026-11-06',
    done: ['Project folders', 'Drawings list', 'Drawing viewer (web)', 'Layers & tag boxes', 'Revisions R0 / R1'],
    pending: [
      'Real Transmittal files',
      'Real RA Bills',
      'Real Quotes',
      'Real site photos',
      'Save uploads',
      'Drawing view on phone',
      'Test tag area & photos',
      'Test upload revision',
      'Test show changes',
      'Consultant reminder',
    ],
    needed: [
      { item: 'Transmittal, bills, quotes', from: 'Client' },
      { item: 'Storage for folders', from: 'Development' },
      { item: 'Phone drawing viewer', from: 'Development' },
      { item: 'OK for reminder service', from: 'PMC team' },
      { item: 'New Play Store build', from: 'Phone update' },
    ],
  },
  {
    screen: 'Access & Roles',
    updated: '2026-11-06',
    done: ['User list', 'Role counts', 'Admin & manager only', 'Create user: admin only'],
    pending: ['Test create user', 'Test email invite', 'Test reset password', 'Test deactivate', 'Test change role', 'Search users', 'Edit name / phone'],
    needed: [
      { item: 'Admin login for testing', from: 'PMC team' },
      { item: 'Managers change roles?', from: 'Client' },
      { item: 'Email domain for invites', from: 'PMC team' },
    ],
  },
  {
    screen: 'Contact Book',
    updated: '2026-11-06',
    done: ['Admin only access', '20 contacts saved'],
    pending: ['Test add / edit contact', 'Test delete contact', 'Test search & filters', 'Test WhatsApp share'],
    needed: [{ item: 'Admin login for testing', from: 'PMC team' }],
  },
  {
    screen: 'DPR',
    updated: '2026-11-06',
    done: ['DPR task list', 'Status buckets', 'Open DPR form', 'Save draft', 'Submit DPR', 'DPR reminder push'],
    pending: [
      'Real submission history',
      'Real quality checklist',
      'Photo location online',
      'Lock submitted DPRs',
      'Fix date on old DPRs',
      'Reminder: skip if submitted',
      'Reminder opens DPR',
      'Test engineer submit',
      'Test photo upload',
      'Test edit requests',
      'Test checklist PDF',
    ],
    needed: [
      { item: 'Engineers on projects', from: 'PMC team' },
      { item: 'Phone for photo tests', from: 'PMC team' },
      { item: 'Fix reminder & lock', from: 'Development' },
      { item: 'New Play Store build', from: 'Phone update' },
    ],
  },
  {
    screen: 'MoM',
    updated: '2026-11-06',
    done: ['Meeting form & checks', 'Task report PDF', 'Weekly test email'],
    pending: [
      'Save meetings online',
      'Invitees for managers',
      'Auto-send schedules',
      'Send by WhatsApp',
      'Transcribe recordings',
      'Save recordings online',
      'Real data in email report',
      'Test monthly email',
      'Test department alert',
      'Test recording on phone',
      'Test agenda & attendance',
    ],
    needed: [
      { item: 'Who gets MoM reports', from: 'Client' },
      { item: 'WhatsApp provider', from: 'PMC team' },
      { item: 'Speech-to-text choice', from: 'PMC team' },
      { item: 'Save MoM online', from: 'Development' },
      { item: 'New Play Store build', from: 'Phone update' },
    ],
  },
  {
    screen: 'Status',
    updated: '2026-11-06',
    done: ['Status by time (4)', 'Architect status', 'Client status', 'Contractor status', 'Task based report'],
    pending: [
      'Real engineer status only',
      'Real contractor name',
      'Skip drafts in totals',
      'Today in India time',
      'Client project picker',
      'Consultant status',
      'Test vendor status',
      'Test department status',
      'Test PDF download',
    ],
    needed: [
      { item: 'Client login for testing', from: 'PMC team' },
      { item: 'Contractor per task', from: 'Client' },
      { item: 'Remove sample data', from: 'Development' },
    ],
  },
];
