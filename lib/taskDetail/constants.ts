// Every value here is ported VERBATIM from admin-web (StatusDropdown.tsx,
// lib/types/tasks.ts, TrelloTaskDetail.tsx) — not "a" similar set, the exact
// same enums/labels/colors/order, so a checklist looks and behaves
// identically regardless of which app you're looking at it from.

// quality_pre_construction/quality_construction/quality_post_construction
// (admin-web's add-quality-of-work-categories.sql) are three real
// categories grouped under one shared "Quality of Work" UI heading in this
// screen (app/checklist-templates/[type].tsx) — the heading itself isn't a
// stored value, only these three are, same flat category->items model as
// every other category.
export type DependencyCategory =
  | 'architect' | 'client' | 'consultant' | 'contractor' | 'procurement' | 'quantity'
  | 'quality_pre_construction' | 'quality_construction' | 'quality_post_construction';

// 'inspector' is an 8th value that still technically exists in the Postgres
// enum but is formally retired (its one item moved under 'procurement') —
// admin-web's own CATEGORIES list omits it everywhere it actually renders,
// same here.
export const CATEGORIES: DependencyCategory[] = [
  'architect', 'client', 'consultant', 'contractor', 'procurement', 'quantity',
  'quality_pre_construction', 'quality_construction', 'quality_post_construction',
];

export const CATEGORY_LABEL: Record<DependencyCategory, string> = {
  architect: 'Architect',
  client: 'Client',
  consultant: 'Consultant',
  contractor: 'Contractor',
  procurement: 'Procurement/Vendor',
  quantity: 'Quantity of Work',
  quality_pre_construction: 'Pre Construction',
  quality_construction: 'Construction',
  quality_post_construction: 'Post Construction',
};

// Same short letter badge as admin-web's ChecklistCard header (CAT_LETTER
// in TrelloTaskDetail.tsx) — "Co"/"Cr" distinguish Consultant from
// Contractor since both would otherwise start with "C".
export const CATEGORY_LETTER: Record<DependencyCategory, string> = {
  architect: 'A',
  client: 'C',
  consultant: 'Co',
  contractor: 'Cr',
  procurement: 'P',
  quantity: 'Q',
  quality_pre_construction: 'Pr',
  quality_construction: 'Cn',
  quality_post_construction: 'Po',
};

export const CATEGORY_COLORS: Record<DependencyCategory, { border: string; bg: string; text: string; badge: string; dot: string }> = {
  architect:   { border: '#4F46E5', bg: '#EEF2FF', text: '#4338CA', badge: '#C7D2FE', dot: '#6366F1' },
  client:      { border: '#059669', bg: '#ECFDF5', text: '#047857', badge: '#A7F3D0', dot: '#10B981' },
  consultant:  { border: '#D97706', bg: '#FFFBEB', text: '#B45309', badge: '#FDE68A', dot: '#F59E0B' },
  contractor:  { border: '#7C3AED', bg: '#F5F3FF', text: '#6D28D9', badge: '#DDD6FE', dot: '#8B5CF6' },
  procurement: { border: '#B45309', bg: '#FFF7ED', text: '#9A3412', badge: '#FED7AA', dot: '#F97316' },
  quantity:    { border: '#BE185D', bg: '#FDF2F8', text: '#9D174D', badge: '#FBCFE8', dot: '#EC4899' },
  quality_pre_construction:  { border: '#0D9488', bg: '#F0FDFA', text: '#0F766E', badge: '#99F6E4', dot: '#14B8A6' },
  quality_construction:      { border: '#1D4ED8', bg: '#EFF6FF', text: '#1E40AF', badge: '#BFDBFE', dot: '#3B82F6' },
  quality_post_construction: { border: '#475569', bg: '#F8FAFC', text: '#334155', badge: '#CBD5E1', dot: '#64748B' },
};

export type CompletionStatus = 'YES' | 'NO' | 'ON_HOLD' | 'PENDING' | 'REVISIONS' | 'PROCEED';

export const STATUS_CHIP: Record<CompletionStatus, { label: string; bg: string; text: string; dot: string }> = {
  YES:       { label: 'Issued',       bg: '#DCFCE7', text: '#15803D', dot: '#22C55E' },
  PROCEED:   { label: 'Proceed',      bg: '#CCFBF1', text: '#0F766E', dot: '#14B8A6' },
  PENDING:   { label: 'Pending',      bg: '#FEE2E2', text: '#B91C1C', dot: '#EF4444' },
  ON_HOLD:   { label: 'On Hold',      bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
  REVISIONS: { label: 'Revisions',    bg: '#FFEDD5', text: '#C2410C', dot: '#FB923C' },
  NO:        { label: 'Not Required', bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
};

// PROCEED is retired from NEW selections (legacy data only) — a picker
// offers only these 5, but any of the 6 above can still be DISPLAYED.
export const STATUS_ORDER: CompletionStatus[] = ['YES', 'PENDING', 'ON_HOLD', 'REVISIONS', 'NO'];

export function isItemDone(status: CompletionStatus): boolean {
  return status === 'YES' || status === 'PROCEED';
}

export type QuantityUnit =
  | 'ROOM_AREA_WISE' | 'RFT' | 'SFT' | 'CFT' | 'SQM' | 'MM' | 'INCH' | 'NO' | 'RMTS' | 'TARGETED_QUANTITY_OF_WORK';

// Fixed order per the client spec — not alphabetized/reordered.
export const QUANTITY_UNIT_OPTIONS: { value: QuantityUnit; label: string }[] = [
  { value: 'ROOM_AREA_WISE', label: 'Room/Area-wise' },
  { value: 'RFT', label: 'RFT' },
  { value: 'SFT', label: 'SFT' },
  { value: 'CFT', label: 'CFT' },
  { value: 'SQM', label: 'Sq.metres' },
  { value: 'MM', label: 'MM' },
  { value: 'INCH', label: 'Inch' },
  { value: 'NO', label: 'Numbers' },
  { value: 'RMTS', label: 'RMTS' },
  { value: 'TARGETED_QUANTITY_OF_WORK', label: 'Targeted Quantity of work' },
];

// The two quantity-category items that are auto-derived server-side
// (Pending = max(Targeted − Done, 0), Excess = max(Done − Targeted, 0)) —
// rendered read-only, matching admin-web. Mobile does not recompute these
// live (that formula is a separate server action, not ported here — same
// "not replicating a whole separate algorithm" precedent as this app's own
// updateTaskActualDate not replicating the planned-date cascade).
export function isComputedQuantityItem(category: DependencyCategory, itemLabel: string): boolean {
  return category === 'quantity' && (itemLabel === 'Pending Quantity' || itemLabel === 'Excess Quantity');
}

// Exact category+itemLabel pairs gated for drawing-revision upload — the
// Architect "Specifications" (plural) vs Consultant "Specification"
// (singular) near-duplicate is deliberate, per admin-web's own comment, not
// a typo to "fix" here.
export const DRAWING_REVISION_ITEMS: { category: DependencyCategory; itemLabel: string }[] = [
  { category: 'architect', itemLabel: '3D Renders' },
  { category: 'architect', itemLabel: 'GFC Drawings' },
  { category: 'architect', itemLabel: 'Specifications' },
  { category: 'consultant', itemLabel: 'Technical Drawing' },
  { category: 'consultant', itemLabel: 'Specification' },
];

export function hasDrawingRevisions(category: DependencyCategory, itemLabel: string): boolean {
  return DRAWING_REVISION_ITEMS.some((d) => d.category === category && d.itemLabel === itemLabel);
}

// The approval-side counterpart to DRAWING_REVISION_ITEMS above — the 4
// real, already-seeded 'client'-category items this was requested for
// (confirmed live against dependency_items, not guessed). Each submit-and-
// decide round gets the next sequential A1/A2/... number, same pattern as
// drawing revisions' R1/R2/....
export const APPROVAL_TRACKING_ITEMS: { category: DependencyCategory; itemLabel: string }[] = [
  { category: 'client', itemLabel: 'Contractor Approval' },
  { category: 'client', itemLabel: 'Design Approval' },
  { category: 'client', itemLabel: 'Equipment Approval' },
  { category: 'client', itemLabel: 'Material Approval' },
];

export function hasApprovalTracking(category: DependencyCategory, itemLabel: string): boolean {
  return APPROVAL_TRACKING_ITEMS.some((a) => a.category === category && a.itemLabel === itemLabel);
}

export type ApprovalOutcome = 'APPROVED' | 'REJECTED';

// Client + Architect + Consultant input, 7 days each, always all 3 added in
// full regardless of the task's AC/AV classification (explicit choice — no
// skipping Consultant for AC tasks or Architect for AV tasks here). Added
// on top of the task's own Procurement Duration Type (task_types.
// default_duration_days) to get the real total lead time before the task's
// planned start date. Mirrored as a plain constant in
// admin-web/prisma/add-procurement-lead-time-alerts.sql for the server-side
// notification cron (a SQL function can't import this file) — keep both in
// sync by hand if this ever changes, same convention as this app's other
// mirrored-constant comments (e.g. TRACKING_END_MINUTES).
export const PROCUREMENT_INPUT_PRESET_DAYS = 21;

export interface ProcurementLeadTime {
  totalLeadTimeDays: number;
  startByISODate: string; // 'YYYY-MM-DD' — the calendar day the whole chain needs to begin
}

// referenceStartISODate is the task's LIVE planned start (current_planned_
// start_date if a cascade has touched it, else the original planned_start_
// date) — scheduling procurement against a stale original commitment once
// an upstream delay has already pushed the real start back would be
// scheduling against a date that's no longer true.
export function computeProcurementLeadTime(procurementTypeDurationDays: number, referenceStartISODate: string): ProcurementLeadTime {
  const totalLeadTimeDays = procurementTypeDurationDays + PROCUREMENT_INPUT_PRESET_DAYS;
  const start = new Date(referenceStartISODate + 'T00:00:00Z');
  const startBy = new Date(start.getTime() - totalLeadTimeDays * 24 * 60 * 60 * 1000);
  return { totalLeadTimeDays, startByISODate: startBy.toISOString().slice(0, 10) };
}

export const MAX_DRAWING_REVISIONS = 5;

export type AccountabilityType = 'ACC' | 'ACV';

// A category "Not Required" for a given task's own AC/AV classification —
// AC tasks don't need Procurement/Vendor, AV tasks don't need Consultant.
// A task with NO classification (accountabilityType null) shows everything
// — this rule only ever HIDES a category, never adds one, and only applies
// once a real classification exists. The underlying dependency_items rows
// are untouched either way (still seeded, still queryable) — this is a
// display rule, not a data rule, same on both platforms.
export function isCategoryNotRequired(
  accountabilityType: AccountabilityType | null,
  category: DependencyCategory
): boolean {
  if (accountabilityType === 'ACC') return category === 'procurement';
  if (accountabilityType === 'ACV') return category === 'consultant';
  return false;
}
