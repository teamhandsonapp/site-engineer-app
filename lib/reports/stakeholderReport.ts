import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';
import { isCategoryNotRequired, type AccountabilityType, type CompletionStatus, type DependencyCategory } from '../taskDetail/constants';
import { fetchContacts, type Contact, type ContactCategory } from '../contacts';

// Report by Architect/Client/Vendor/Contractor/Dept — by explicit request,
// these are NOT a date-range list (that's app/reports/activity-report.tsx's
// job for Day/Week/Month/Custom). This is a live, project-wide snapshot:
// "what input is this party still holding up, and what does that delay
// downstream" — built on the SAME real checklist (dependency_items +
// dependency_completions) every task's own checklist screen and
// GeneralParameterSection's single-task "Reasons for Delay" already use,
// just aggregated across every open task in the project instead of one.

export type StakeholderFilter = { kind: 'category'; category: DependencyCategory } | { kind: 'department'; workName: string };

export interface StakeholderPendingItem {
  label: string;
  isMandatory: boolean;
  status: CompletionStatus;
}

export interface StakeholderTaskRow {
  taskId: string;
  taskCode: string;
  taskName: string;
  workName: string; // Department
  dueDate: string | null;
  isOverdue: boolean;
  pendingItems: StakeholderPendingItem[];
  // Downstream tasks THIS task is holding up (task_dependencies where
  // depends_on_task_id = this task) — "what will be affected", per the
  // request.
  blocking: { taskCode: string; taskName: string }[];
}

export interface StakeholderReport {
  rows: StakeholderTaskRow[];
  affectedTaskCount: number;
  delayedTaskCount: number;
  totalPendingItems: number;
  // Contact Book entries matching this category (category mode only) — "if
  // we go to Report by Client it will show the Client name," per the
  // request; pulled from the real Contact Book (lib/contacts.ts) rather
  // than inventing a name field nowhere else in the schema has. Empty for
  // a non-admin caller (contacts is admin-only RLS) or department mode.
  contacts: Contact[];
}

// contacts.ts's ContactCategory uses 'vendor' where the checklist's own
// DependencyCategory uses 'procurement' for the same real-world party —
// same label mismatch GeneralParameterSection.tsx already works around.
const CATEGORY_TO_CONTACT: Partial<Record<DependencyCategory, ContactCategory>> = {
  architect: 'architect',
  client: 'client',
  consultant: 'consultant',
  contractor: 'contractor',
  procurement: 'vendor',
};

interface RawWork {
  name: string;
  code: string | null;
  project_id: string;
  accountability_type: AccountabilityType | null;
}

interface RawCompletion {
  status: CompletionStatus;
}

interface RawItem {
  category: DependencyCategory;
  item_label: string;
  is_mandatory: boolean;
  sort_order: number;
  completion: RawCompletion | RawCompletion[] | null;
}

interface RawTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  due_date: string | null;
  actual_end_date: string | null;
  accountability_type: AccountabilityType | null;
  work: RawWork | RawWork[] | null;
  dependency_items: RawItem[] | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

// PostgREST caps a single response at 1000 rows — same pagination
// convention as every other report fetch in this app.
const PAGE_SIZE = 1000;

const STAKEHOLDER_TASK_SELECT = `
  id, task_id, task_name, due_date, actual_end_date, accountability_type,
  work:works!inner(name, code, project_id, accountability_type),
  dependency_items(category, item_label, is_mandatory, sort_order, completion:dependency_completions(status))
`;

// PENDING/ON_HOLD/REVISIONS are genuinely still-outstanding — YES/PROCEED
// are done, and NO ("Not Required") was explicitly marked as not needed,
// so neither belongs in a "what's still pending" list.
//
// A NULL completion (no dependency_completions row at all) is deliberately
// EXCLUDED, not treated as an implicit PENDING — confirmed against real
// data: a freshly-seeded checklist item has no completion row until
// someone actually opens it and sets a status, and the vast majority of
// items across this project's 300+ tasks have never been touched (e.g.
// 1500+ untouched vs. single-digit explicitly-PENDING items per category).
// Counting every untouched item as "pending" would flood this report with
// noise from tasks nobody's reached yet, rather than the real, actively-
// flagged blockers this report exists to surface.
function isPendingNeeded(status: CompletionStatus | null): boolean {
  return status === 'PENDING' || status === 'ON_HOLD' || status === 'REVISIONS';
}

export async function fetchStakeholderReport(projectId: string, filter: StakeholderFilter): Promise<StakeholderReport> {
  const all: RawTaskRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tasks')
      .select(STAKEHOLDER_TASK_SELECT)
      .eq('work.project_id', projectId)
      .neq('status', 'completed')
      .is('deleted_at', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RawTaskRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows: StakeholderTaskRow[] = [];

  for (const r of all) {
    const work = normalizeToOne(r.work);
    if (!isPilotVisible(r.task_id, work?.code)) continue;
    if (filter.kind === 'department' && work?.name !== filter.workName) continue;

    const accountabilityType = r.accountability_type ?? work?.accountability_type ?? null;
    const items = r.dependency_items ?? [];
    const pendingItems: StakeholderPendingItem[] = items
      .filter((i) => filter.kind !== 'category' || i.category === filter.category)
      .filter((i) => !isCategoryNotRequired(accountabilityType, i.category))
      .filter((i) => isPendingNeeded(normalizeToOne(i.completion)?.status ?? null))
      .sort((a, b) => a.sort_order - b.sort_order)
      // isPendingNeeded above already guarantees a real, non-null status
      // survived the filter, so this cast is safe.
      .map((i) => ({ label: i.item_label, isMandatory: i.is_mandatory, status: normalizeToOne(i.completion)!.status }));

    if (pendingItems.length === 0) continue;

    const isOverdue = !!(r.due_date && r.due_date < today && (r.actual_end_date == null || r.actual_end_date > today));

    rows.push({
      taskId: r.id,
      taskCode: r.task_id,
      taskName: r.task_name,
      workName: work?.name ?? 'Unassigned',
      dueDate: r.due_date,
      isOverdue,
      pendingItems,
      blocking: [],
    });
  }

  // Downstream impact — same batch-resolve shape as rangeTaskReport.ts's
  // own blockedBy/blocking, just the one direction this report needs.
  const taskIds = rows.map((r) => r.taskId);
  if (taskIds.length > 0) {
    const { data: blockingRows, error: blockingError } = await supabase
      .from('task_dependencies')
      .select('task_id, depends_on_task_id')
      .in('depends_on_task_id', taskIds);
    if (blockingError) throw new Error(blockingError.message);

    const downstreamIds = [...new Set((blockingRows ?? []).map((d) => d.task_id as string))];
    const refMap = new Map<string, { taskCode: string; taskName: string }>();
    if (downstreamIds.length > 0) {
      const { data: refTasks, error: refError } = await supabase.from('tasks').select('id, task_id, task_name').in('id', downstreamIds);
      if (refError) throw new Error(refError.message);
      for (const t of refTasks ?? []) refMap.set(t.id, { taskCode: t.task_id, taskName: t.task_name });
    }

    const blockingOf = new Map<string, { taskCode: string; taskName: string }[]>();
    for (const d of blockingRows ?? []) {
      const ref = refMap.get(d.task_id as string);
      if (!ref) continue;
      const list = blockingOf.get(d.depends_on_task_id as string) ?? [];
      list.push(ref);
      blockingOf.set(d.depends_on_task_id as string, list);
    }
    for (const row of rows) row.blocking = blockingOf.get(row.taskId) ?? [];
  }

  rows.sort((a, b) => (b.isOverdue ? 1 : 0) - (a.isOverdue ? 1 : 0) || a.taskCode.localeCompare(b.taskCode));

  let contacts: Contact[] = [];
  if (filter.kind === 'category') {
    const contactCategory = CATEGORY_TO_CONTACT[filter.category];
    if (contactCategory) {
      contacts = (await fetchContacts().catch(() => [])).filter((c) => c.category === contactCategory);
    }
  }

  return {
    rows,
    affectedTaskCount: rows.length,
    delayedTaskCount: rows.filter((r) => r.isOverdue).length,
    totalPendingItems: rows.reduce((sum, r) => sum + r.pendingItems.length, 0),
    contacts,
  };
}

// Distinct department (Work) names for a project — the picker behind
// "Report by Dept". Same underlying concept as the flowchart filter's own
// allDepartments (task.workName), just fetched directly off works rather
// than derived from a full task list.
export async function fetchProjectDepartmentNames(projectId: string): Promise<string[]> {
  const { data, error } = await supabase.from('works').select('name').eq('project_id', projectId);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((w) => w.name as string))].sort();
}
