import type { RelationshipType } from './types';

export type TemplateLinkType = RelationshipType;

// Mirrors admin-web's TemplateTask/TemplateLink (prisma/schema.prisma) — a
// template task has NO real dates (dayOffsetStart/End are working-day
// offsets relative to the template's own day 0, replayed against a chosen
// anchor date at apply time — see lib/flowchart/templates.ts's own
// computeTemplateApplyPreview), no AC/AV, no Task Type, no delay/actual
// dates. workName is plain text (not a real Work FK) since the target
// project's Works may not exist yet when this template is authored.
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
}
