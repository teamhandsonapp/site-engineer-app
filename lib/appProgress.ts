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
export const APP_PROGRESS: ScreenProgress[] = [
  {
    screen: 'Notifications',
    updated: '2026-11-06',
    done: ['6 notification groups', 'Live alert bell', 'DPR reminder push', 'Send critical alerts', 'Location group auto-hide'],
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
];
