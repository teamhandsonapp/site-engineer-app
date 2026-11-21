// Past Tasks Reports — milestone filter (2026-11-21, client confirmed).
// The four milestones over the Past Works board (28 Past Tasks + the Current
// Status tasks copied below them). Each holds the tasks named for it plus every
// task linked before them, filled in this order. Picking one in the report
// makes the whole report (screen, Excel, PDF) cover only its tasks.
// Kept in code, not the milestones table, so nothing changes on other tabs.
export interface PastMilestone {
  name: string;
  taskCodes: string[];
}

export const PAST_MILESTONES: PastMilestone[] = [
  {
    name: '+3\'-6" slab',
    taskCodes: ['PT-06', 'PT-07', 'PT-02', 'PT-09', 'PT-10', 'PT-12', 'PT-13', 'PT-14', 'PT-15', 'PT-16', 'PT-18', 'PT-19', 'PT-17', 'PT-20', 'PT-21', 'PT-22'],
  },
  {
    name: 'Mezzanine slab',
    taskCodes: ['PT-23', 'PT-24', 'PT-26', 'PT-27', 'PT-30', 'CIV-07', 'CIV-08', 'CIV-12', 'CIV-17'],
  },
  {
    name: 'PCC works',
    taskCodes: ['PT-25', 'CIV-16', 'ELE-01', 'CIV-15', 'CIV-14', 'CIV-20', 'CIV-28', 'PLB-02', 'PLB-01', 'CIV-30', 'CIV-32', 'CIV-36'],
  },
  {
    name: 'Roof beam',
    taskCodes: [
      'CIV-09', 'CIV-22', 'CIV-05', 'CIV-03', 'CIV-01', 'CIV-02', 'CIV-04', 'CIV-06', 'CIV-10', 'CIV-13', 'CIV-19',
      'CIV-21', 'CIV-23', 'CIV-24', 'CIV-26', 'CIV-27', 'CIV-29', 'CIV-31', 'CIV-34', 'CIV-37', 'FAB-04',
    ],
  },
];

/** "Milestone 2 – Mezzanine slab" */
export const pastMilestoneLabel = (name: string) => `Milestone ${PAST_MILESTONES.findIndex((m) => m.name === name) + 1} – ${name}`;
