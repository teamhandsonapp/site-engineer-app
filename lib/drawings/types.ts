// Shared between server and client for the drawing viewer — plain values
// and types only (no server imports), so client components can use them.

export type DrawingDiscipline = 'ARCHITECTURAL' | 'STRUCTURAL' | 'ELECTRICAL' | 'PLUMBING' | 'HVAC' | 'OTHER';

export const DISCIPLINES: DrawingDiscipline[] = ['ARCHITECTURAL', 'STRUCTURAL', 'ELECTRICAL', 'PLUMBING', 'HVAC', 'OTHER'];

export const DISCIPLINE_LABEL: Record<DrawingDiscipline, string> = {
  ARCHITECTURAL: 'Architectural',
  STRUCTURAL: 'Structural',
  ELECTRICAL: 'Electrical',
  PLUMBING: 'Plumbing',
  HVAC: 'HVAC',
  OTHER: 'Other',
};

// Ink colour a consultant sheet is tinted with when laid over the base
// sheet. Architectural stays near-black (it is the base drawing itself).
export const DISCIPLINE_COLOR: Record<DrawingDiscipline, string> = {
  ARCHITECTURAL: '#1A2230',
  STRUCTURAL: '#8A6D46',
  ELECTRICAL: '#D9480F',
  PLUMBING: '#1C7ED6',
  HVAC: '#0F9D8A',
  OTHER: '#7C3AED',
};

export const MAX_DRAWING_PDF_MB = 50;
export const MAX_TAG_PHOTO_MB = 10;

// What colour a tagged box is drawn in, derived from its linked task.
export type TagStatusKind = 'done' | 'progress' | 'delayed' | 'idle' | 'none';

export const TAG_STATUS_LABEL: Record<TagStatusKind, string> = {
  done: 'Done',
  progress: 'In progress',
  delayed: 'Delayed',
  idle: 'Not started',
  none: 'No task linked',
};

export const TAG_STATUS_COLOR: Record<TagStatusKind, string> = {
  done: '#15803D',
  progress: '#B45309',
  delayed: '#DC2626',
  idle: '#6B7280',
  none: '#2563EB',
};

const TASK_STATUS_TEXT: Record<string, string> = {
  draft: 'Draft',
  ready: 'Ready',
  in_progress: 'In progress',
  on_hold: 'On hold',
  blocked: 'Blocked',
  completed: 'Completed',
};

export function taskStatusText(status: string): string {
  return TASK_STATUS_TEXT[status] ?? status;
}

// Delayed = not completed and past its (current, cascaded) due date, or
// explicitly blocked / on hold. dueDate is a YYYY-MM-DD string.
export function tagStatusFor(task: { status: string; dueDate: string | null } | null, today: string): TagStatusKind {
  if (!task) return 'none';
  if (task.status === 'completed') return 'done';
  if (task.status === 'blocked' || task.status === 'on_hold') return 'delayed';
  if (task.dueDate && task.dueDate < today) return 'delayed';
  if (task.status === 'in_progress') return 'progress';
  return 'idle';
}

export function revLabel(n: number): string {
  return `R${n}`;
}

/* ── Viewer payload (server → client) ────────────────────────────── */

export interface DrawingVersionDTO {
  id: string;
  revisionNumber: number;
  fileName: string;
  fileSizeBytes: number;
  changeNote: string | null;
  basedOnRevision: number | null;
  uploadedByName: string | null;
  uploadedAt: string; // ISO
  url: string | null; // signed, short-lived
}

export interface ConsultantStatusDTO {
  state: 'current' | 'outdated' | 'never_issued' | 'no_base';
  // Only meaningful when state is outdated / never_issued.
  dueAt: string | null; // ISO
  overdueDays: number; // 0 if not overdue
}

export interface OverlayDTO {
  id: string;
  sheetNumber: string;
  title: string;
  discipline: DrawingDiscipline;
  consultantName: string | null;
  consultantEmail: string | null;
  responseDays: number;
  lastReminderAt: string | null;
  versions: DrawingVersionDTO[]; // newest first
  status: ConsultantStatusDTO;
}

export interface TagPhotoDTO {
  id: string;
  caption: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
  url: string | null;
}

export interface TagDTO {
  id: string;
  page: number;
  name: string;
  layer: DrawingDiscipline;
  room: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  task: {
    id: string;
    code: string;
    name: string;
    status: string;
    dueDate: string | null;
    workName: string | null;
  } | null;
  statusKind: TagStatusKind;
  photos: TagPhotoDTO[]; // newest first
}

export interface TaskOptionDTO {
  id: string;
  code: string;
  name: string;
  status: string;
  workName: string | null;
}

export interface DrawingViewerDTO {
  project: { id: string; name: string };
  drawing: {
    id: string;
    sheetNumber: string;
    title: string;
    discipline: DrawingDiscipline;
    consultantName: string | null;
    consultantEmail: string | null;
    responseDays: number;
    lastReminderAt: string | null;
    base: { id: string; sheetNumber: string; title: string } | null;
  };
  versions: DrawingVersionDTO[]; // newest first
  // This sheet's own consultant status when it is itself an overlay sheet.
  selfStatus: ConsultantStatusDTO | null;
  overlays: OverlayDTO[];
  tags: TagDTO[];
  tasks: TaskOptionDTO[];
  rooms: string[]; // room names already used on this sheet, for suggestions
  today: string; // YYYY-MM-DD, server's view of "today" for status colours
  floor: FloorDTO;
}

// A floor plan = one base (architectural) sheet + the department sheets
// drawn over it. Used for the department switcher in the viewer.
export interface FloorDTO {
  baseId: string;
  title: string;
  sheets: { id: string; sheetNumber: string; discipline: DrawingDiscipline }[]; // base first
}

export type DrawingResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export interface UploadTarget {
  path: string;
  token: string;
}

// Private Supabase Storage bucket holding drawing PDFs and tag photos.
export const DRAWINGS_BUCKET = 'project-drawings';
