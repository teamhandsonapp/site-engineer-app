// App Progress: one entry per app screen — what is done, what is pending,
// and what is needed (and from whom) to finish it. Shown on the App
// Progress screen. Add the next screen as a new entry; keep the wording
// plain (it is shown to the team and in client meetings).

export type ProgressFrom = 'Client' | 'PMC team' | 'Development' | 'Phone update';

export interface ScreenProgress {
  screen: string;
  where: string; // how to find it in the app
  updated: string; // YYYY-MM-DD
  summary: string;
  done: string[];
  pending: string[];
  needed: { item: string; from: ProgressFrom }[];
}

export const APP_PROGRESS: ScreenProgress[] = [
  {
    screen: 'Notifications',
    where: 'Menu → Notifications, or the bell icon at the top of every screen (admin and manager)',
    updated: '2026-11-06',
    summary: 'Real phone push messages and the live alert bell work. The Notifications list itself still shows sample items.',
    done: [
      'Notifications screen with 7 groups: Critical Alerts, Location, Attendance, Daily Updates, Leave, Tasks, Messages — each a collapsible box with a count badge',
      'Bell icon on every screen with a live count of real critical alerts (site issues, boundary exits, restricted zones, location off, locked accounts)',
      'Push messages to phones are live: new checklist item, checklist completion and status change, zone alert, invoice sent',
      'Admin can send a broadcast push to everyone (Send notification card)',
      'Critical alert pop-up on screen when a critical alert message arrives',
      'Location group is hidden while location features are switched off',
    ],
    pending: [
      'The list shows SAMPLE notifications (35 demo items) — not real data yet',
      'Switch Critical Alerts, Location and Messages to real data (the real data source already exists)',
      'Build real data for Attendance, Daily Updates, Leave and Tasks notifications',
      'Tapping a notification should open the related screen (task, leave request, alert)',
      'Read / unread, "Mark all as read" and clearing old notifications',
      'A notifications list for site engineers (today only admin and manager have one)',
      'Time limit on push sending so a slow push service never delays the app (planned for the v36 update)',
      'Save the broadcast-push server code in the code repository (it is live but its code is not in the repo)',
    ],
    needed: [
      { item: 'Which events should notify which roles for Attendance, Daily Updates, Leave and Tasks', from: 'Client' },
      { item: 'Should site engineers get their own notifications list, and what should it show', from: 'Client' },
      { item: 'Show notifications for all projects together, or only the selected project', from: 'PMC team' },
      { item: 'Approval for one small database table to remember read / unread', from: 'PMC team' },
      { item: 'Wire real data group by group, then open-on-tap and read / unread', from: 'Development' },
      { item: 'New Play Store build for push changes to reach phones (the app has no over-the-air updates)', from: 'Phone update' },
    ],
  },
];
