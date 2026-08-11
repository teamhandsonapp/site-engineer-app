import { supabase } from '../supabase';
import { addWorkingDaysFromAnchor } from '../workingDays';
import { fetchDependencyTemplate, seedDependencyItems, createDependency, createParallelLink, type WorkOption } from './data';
import type { DependencyType } from './types';

export type TemplateLinkType = DependencyType | 'PARALLEL';

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  taskCount: number;
}

export interface TemplateTaskDetail {
  id: string; // TemplateTask.id
  trackLabel: string | null;
  taskName: string;
  workName: string;
  dayOffsetStart: number;
  dayOffsetEnd: number;
  sortOrder: number;
}

export interface TemplateLinkDetail {
  id: string;
  fromTemplateTaskId: string;
  toTemplateTaskId: string;
  linkType: TemplateLinkType;
}

export interface TemplateDetail {
  id: string;
  name: string;
  description: string | null;
  tasks: TemplateTaskDetail[];
  links: TemplateLinkDetail[];
}

function parseDateKeyUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Same "own copy per module" convention as procurementSchedule.ts's
// fetchBlockedDates — small enough that sharing a single exported version
// isn't worth the churn of touching that already-working file.
async function fetchBlockedDates(years: Set<number>): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (years.size === 0) return blocked;
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const { data, error } = await supabase
    .from('holidays')
    .select('date')
    .gte('date', `${minYear}-01-01`)
    .lte('date', `${maxYear}-12-31`);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { date: string }[]) blocked.add(row.date);
  return blocked;
}

// A generous calendar-day upper bound for "how far past the anchor could
// `maxOffsetDays` working days actually land" — used only to pick which
// years' holiday rows to fetch (chicken-and-egg: computing the exact date
// needs blockedDates, but fetching blockedDates needs a year range). Even in
// the worst case (every single day blocked except workable ones), working
// days need at most ~7/6 as many calendar days for Sundays alone, plus a
// handful more for holidays — doubling plus a flat 30-day pad is comfortably
// safe without needing to be exact.
function yearsSpanning(anchor: Date, maxOffsetDays: number): Set<number> {
  const years = new Set<number>();
  const upper = new Date(anchor);
  upper.setUTCDate(upper.getUTCDate() + Math.ceil(Math.max(0, maxOffsetDays) * 2) + 30);
  for (let y = anchor.getUTCFullYear(); y <= upper.getUTCFullYear(); y++) years.add(y);
  return years;
}

export async function fetchFlowchartTemplates(): Promise<TemplateSummary[]> {
  const { data, error } = await supabase
    .from('flowchart_templates')
    .select('id, name, description, created_at, template_tasks(id)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string; description: string | null; created_at: string; template_tasks: { id: string }[] | null }[])
    .map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      createdAt: t.created_at,
      taskCount: t.template_tasks?.length ?? 0,
    }));
}

export async function fetchTemplateDetail(templateId: string): Promise<TemplateDetail> {
  const [templateRes, tasksRes, linksRes] = await Promise.all([
    supabase.from('flowchart_templates').select('id, name, description').eq('id', templateId).single(),
    supabase
      .from('template_tasks')
      .select('id, track_label, task_name, work_name, day_offset_start, day_offset_end, sort_order')
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('template_links')
      .select('id, from_template_task_id, to_template_task_id, link_type')
      .eq('template_id', templateId),
  ]);
  if (templateRes.error) throw new Error(templateRes.error.message);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);

  return {
    id: templateRes.data.id,
    name: templateRes.data.name,
    description: templateRes.data.description,
    tasks: (tasksRes.data ?? []).map((t) => ({
      id: t.id,
      trackLabel: t.track_label,
      taskName: t.task_name,
      workName: t.work_name,
      dayOffsetStart: t.day_offset_start,
      dayOffsetEnd: t.day_offset_end,
      sortOrder: t.sort_order,
    })),
    links: (linksRes.data ?? []).map((l) => ({
      id: l.id,
      fromTemplateTaskId: l.from_template_task_id,
      toTemplateTaskId: l.to_template_task_id,
      linkType: l.link_type as TemplateLinkType,
    })),
  };
}

export interface WorkMatch {
  workName: string;
  matchedWorkId: string | null;
  matchedWorkCode: string | null;
}

// Exact, case/whitespace-insensitive name match against the target
// project's existing Works — never a fuzzy/partial match, so a near-miss
// (e.g. "Civil Work" vs "Civil Works") is surfaced to the person as
// unmatched rather than silently mapped to the wrong Work.
export function matchTemplateWorks(tasks: TemplateTaskDetail[], projectWorks: WorkOption[]): WorkMatch[] {
  const distinctNames = [...new Set(tasks.map((t) => t.workName))];
  return distinctNames.map((workName) => {
    const match = projectWorks.find((w) => w.name.trim().toLowerCase() === workName.trim().toLowerCase());
    return { workName, matchedWorkId: match?.id ?? null, matchedWorkCode: match?.code ?? null };
  });
}

export interface TemplateApplyPreviewTask extends TemplateTaskDetail {
  plannedStartDate: string; // 'YYYY-MM-DD', computed from the anchor date
  dueDate: string;
}

// Pure computation, no writes — drives the mandatory preview step (Part
// 3.6: nothing gets created until the person has seen these exact dates
// and confirmed). Re-used verbatim by applyFlowchartTemplate below so the
// dates actually written can never drift from what was previewed.
export async function computeTemplateApplyPreview(
  tasks: TemplateTaskDetail[],
  anchorDateKey: string
): Promise<TemplateApplyPreviewTask[]> {
  const anchor = parseDateKeyUtc(anchorDateKey);
  const maxOffset = Math.max(0, ...tasks.map((t) => t.dayOffsetEnd));
  const blocked = await fetchBlockedDates(yearsSpanning(anchor, maxOffset));

  return tasks.map((t) => ({
    ...t,
    plannedStartDate: toDateKeyUtc(addWorkingDaysFromAnchor(anchor, t.dayOffsetStart, blocked)),
    dueDate: toDateKeyUtc(addWorkingDaysFromAnchor(anchor, t.dayOffsetEnd, blocked)),
  }));
}

export interface WorkResolution {
  workName: string;
  // Exactly one of these two is set — the UI enforces that before enabling
  // "Confirm & Create": either map to an existing Work in the target
  // project, or supply a brand-new one's name/code. Never both, never
  // neither (matches the "don't silently create a duplicate Work" rule —
  // there is no default/fallback path here).
  existing: { workId: string; workCode: string } | null;
  createNew: { name: string; code: string } | null;
}

export interface ApplyTemplateResult {
  createdTaskCount: number;
  createdLinkCount: number;
  createdWorkCount: number;
}

// The actual commit — call only after computeTemplateApplyPreview's result
// has been shown to and confirmed by the person, and every distinct
// workName has a WorkResolution. Creates real Works (if requested),
// real Tasks (with the checklist seeded the same way Create Task does),
// then real TaskDependency/TaskParallelLink rows recreating every
// TemplateLink with its original type preserved.
export async function applyFlowchartTemplate(input: {
  projectId: string;
  previewTasks: TemplateApplyPreviewTask[];
  links: TemplateLinkDetail[];
  workResolutions: WorkResolution[];
}): Promise<ApplyTemplateResult> {
  const workByName = new Map<string, { id: string; code: string }>();
  let createdWorkCount = 0;

  for (const res of input.workResolutions) {
    if (res.existing) {
      workByName.set(res.workName, { id: res.existing.workId, code: res.existing.workCode });
    } else if (res.createNew) {
      const code = res.createNew.code.trim().toUpperCase();
      const { data, error } = await supabase
        .from('works')
        // Work.updatedAt is `@updatedAt` in Prisma — a client-side ORM
        // timestamp, not a Postgres column default — so a direct
        // PostgREST insert (this call bypasses Prisma entirely) must
        // supply it explicitly or the NOT NULL constraint rejects the
        // row (same recurring gotcha already fixed on tasks/projects/
        // user_profiles inserts elsewhere in this app).
        .insert({ name: res.createNew.name.trim(), code, project_id: input.projectId, updated_at: new Date().toISOString() })
        .select('id, code')
        .single();
      if (error) throw new Error(error.message);
      workByName.set(res.workName, { id: data.id, code: data.code });
      createdWorkCount++;
    } else {
      throw new Error(`No Work chosen for "${res.workName}"`);
    }
  }

  const checklistTemplate = await fetchDependencyTemplate();
  const templateTaskIdToRealId = new Map<string, string>();

  // Sequential, not parallel — each task_id embeds Date.now(), and this
  // guarantees strictly increasing timestamps so a whole template's worth
  // of tasks (which would otherwise all fire within the same millisecond)
  // never collides on the unique task_id constraint.
  let i = 0;
  for (const t of input.previewTasks) {
    const work = workByName.get(t.workName);
    if (!work) throw new Error(`Work "${t.workName}" was not resolved`);

    const taskId = `${work.code}-${(Date.now() + i).toString().slice(-6)}`;
    i++;
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        task_id: taskId,
        task_name: t.taskName,
        project_name: work.code,
        planned_start_date: t.plannedStartDate,
        due_date: t.dueDate,
        work_id: work.id,
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    templateTaskIdToRealId.set(t.id, data.id);
    await seedDependencyItems(data.id, checklistTemplate);
  }

  let createdLinkCount = 0;
  for (const link of input.links) {
    const fromId = templateTaskIdToRealId.get(link.fromTemplateTaskId);
    const toId = templateTaskIdToRealId.get(link.toTemplateTaskId);
    if (!fromId || !toId) continue; // shouldn't happen — every link's endpoints came from this same template's tasks

    if (link.linkType === 'PARALLEL') {
      await createParallelLink(fromId, toId);
    } else {
      await createDependency(fromId, toId, link.linkType);
    }
    createdLinkCount++;
  }

  return { createdTaskCount: input.previewTasks.length, createdLinkCount, createdWorkCount };
}
