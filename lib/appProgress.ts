// App Progress: one entry per app screen — what is done, what is pending,
// and what is needed (and from whom) to finish it. Shown on the App
// Progress screen. Add the next screen as a new entry. Keep every item a
// short name (a few words, one line) — no sentences.

export type ProgressFrom = 'Client' | 'Prakash' | 'Development' | 'Phone update';

export interface ScreenProgress {
  screen: string;
  updated: string; // YYYY-MM-DD
  done: string[];
  pending: string[];
  needed: { item: string; from: ProgressFrom }[];
}

// Add one entry per screen below.
export const APP_PROGRESS: ScreenProgress[] = [
  {
    screen: 'Files',
    updated: '2026-11-10',
    done: [],
    pending: ['Test with client drawings'],
    needed: [
      { item: 'Project PDF drawings', from: 'Client' },
      { item: 'Files: drawings only, or also Transmittal / RA / Quotes?', from: 'Client' },
      { item: 'Each drawing: department, room, floor', from: 'Client' },
    ],
  },
  {
    screen: 'Access & Roles',
    updated: '2026-11-10',
    done: [],
    pending: ['Set up roles from client list'],
    needed: [
      { item: 'List of all people and their role (Manager, Site Engineer, Admin, Director, etc.)', from: 'Client' },
      { item: 'For each role: what they do', from: 'Client' },
      { item: 'For each role: what they can see in the app', from: 'Client' },
    ],
  },
  {
    screen: 'MoM',
    updated: '2026-11-10',
    done: [],
    pending: ['Test Google Calendar event sync', 'Test WhatsApp meeting reminders'],
    needed: [
      { item: 'Email for Google Calendar event sync', from: 'Client' },
    ],
  },
  {
    screen: 'Client Portal',
    updated: '2026-11-10',
    done: [],
    pending: ['Set up client view from their answers'],
    needed: [
      { item: 'What the client can see in the app (which tabs)', from: 'Client' },
      { item: 'Client logins: do we create and send them, or how should it work?', from: 'Client' },
    ],
  },
  {
    screen: 'Contact Book',
    updated: '2026-11-10',
    done: [],
    pending: ['Check add-contact format with client'],
    needed: [
      { item: 'Add-contact format: which details to fill in', from: 'Client' },
    ],
  },
  {
    screen: 'Flowchart',
    updated: '2026-11-10',
    done: [],
    pending: ['Client testing'],
    needed: [
      { item: 'Test: add tasks themselves', from: 'Client' },
      { item: 'Test: link tasks', from: 'Client' },
      { item: 'Test: check tasks and links in the flowchart', from: 'Client' },
    ],
  },
  {
    screen: 'Google Play Store',
    updated: '2026-11-10',
    done: ['2 testers joined'],
    pending: ['10 more testers to accept the test invite', '14-day closed test to complete'],
    needed: [
      { item: 'Ask the people whose emails were shared to accept the test invite', from: 'Client' },
      { item: 'Ask testers to keep the app installed and keep testing for 14 days', from: 'Client' },
    ],
  },
];
