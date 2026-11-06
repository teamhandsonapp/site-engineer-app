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
];
