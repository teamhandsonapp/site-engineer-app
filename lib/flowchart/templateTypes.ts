import type { AccountabilityType, RelationshipType } from './types';

export type TemplateLinkType = RelationshipType;

// Mirrors admin-web's TemplateTask/TemplateLink (prisma/schema.prisma) — a
// template task has NO real dates (dayOffsetStart/End are working-day
// offsets relative to the template's own day 0, replayed against a chosen
// anchor date at apply time — see lib/flowchart/templates.ts's own
// computeTemplateApplyPreview), no Task Type, no delay/actual dates.
// workName is plain text (not a real Work FK) since the target project's
// Works may not exist yet when this template is authored. accountabilityType
// mirrors Task.accountabilityType exactly (see admin-web's own field
// comment) — an explicit per-task override, nullable, that only drives the
// AC/AV shown on THIS template's own canvas (never read by
// applyFlowchartTemplate — a real applied Task still gets its own
// accountability resolved the normal way).
export interface TemplateTask {
  id: string;
  trackLabel: string | null;
  taskName: string;
  workName: string;
  dayOffsetStart: number;
  dayOffsetEnd: number;
  sortOrder: number;
  manualPositionX: number | null;
  manualPositionY: number | null;
  accountabilityType: AccountabilityType | null;
}

export interface TemplateSeriesEdge {
  id: string;
  taskId: string; // toTemplateTaskId — the blocked task
  dependsOnTaskId: string; // fromTemplateTaskId — the prerequisite
  type: 'FS' | 'SS' | 'FF' | 'SF';
}

export interface TemplateParallelEdge {
  id: string;
  taskAId: string;
  taskBId: string;
}

export interface PositionedTemplateTask extends TemplateTask {
  x: number;
  y: number;
}

export interface TemplateMeta {
  id: string;
  name: string;
  description: string | null;
  // The fixed anchor real-world date that this template's own day-offset
  // authoring UI (the task-creation popup's calendar pickers) converts
  // against — see lib/flowchart/templateDates.ts. Never read by
  // applyFlowchartTemplate (that uses whatever anchor date is chosen at
  // apply time instead); purely an authoring-UI convenience so a calendar
  // date picked today converts back to the SAME calendar date when
  // displayed later, consistently, regardless of which day it's viewed on.
  createdAt: string;
}
