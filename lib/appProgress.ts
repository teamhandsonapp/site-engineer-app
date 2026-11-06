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

export const APP_PROGRESS: ScreenProgress[] = [
  {
    screen: 'Notifications',
    updated: '2026-11-06',
    done: ['7 notification groups', 'Live alert bell', 'Push to phones', 'Admin broadcast push', 'Critical alert pop-up', 'Location group auto-hide'],
    pending: ['Real data (now sample)', 'Real alerts, location, messages', 'Attendance, DPR, leave, tasks', 'Tap to open item', 'Read / unread', 'Site engineer list', 'Push time limit', 'Broadcast code in repo'],
    needed: [
      { item: 'Who gets which alerts', from: 'Client' },
      { item: 'Site engineer list?', from: 'Client' },
      { item: 'All projects or one', from: 'PMC team' },
      { item: 'OK for read / unread table', from: 'PMC team' },
      { item: 'Connect real data', from: 'Development' },
      { item: 'New Play Store build', from: 'Phone update' },
    ],
  },
];
