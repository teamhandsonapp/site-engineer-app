import { supabase } from './supabase';
import { isPilotVisible } from './pilot';

// A checklist item's completion row is created LAZILY on first response, not
// at task-creation time (confirmed live: far more dependency_items exist
// than dependency_completions) — so "no completion row yet" is treated as
// equivalent to PENDING throughout this file, not as "nothing to show."
//
// "Needs attention" is everything except the two clearing statuses (YES,
// PROCEED) — broadened from the original PENDING/REVISIONS-only condition
// to also include ON_HOLD and NO. Those two aren't just "unanswered," they're
// an active problem someone raised (a pause or a decline), which is at least
// as attention-worthy as a plain unanswered item, arguably more so — so they
// count too, distinguished via `isFlagged` rather than being excluded.
// Kept in exact sync with admin-web's push-notification trigger condition
// (supabase/push-notifications.sql) and admin-web's own notifications panel
// (lib/data/notifications.ts) — all three must move together.
export type NeedsAttentionStatus = 'PENDING' | 'REVISIONS' | 'ON_HOLD' | 'NO';
const NEEDS_ATTENTION_STATUSES: NeedsAttentionStatus[] = ['PENDING', 'REVISIONS', 'ON_HOLD', 'NO'];
const FLAGGED_STATUSES: NeedsAttentionStatus[] = ['ON_HOLD', 'NO'];

export interface CriticalAlert {
  itemId: string;
  itemLabel: string;
  taskId: string;
  taskName: string;
  workName: string;
  workCode: string;
  projectId: string;
  projectName: string;
  status: NeedsAttentionStatus;
  // ON_HOLD or NO — someone actively raised a concern, as opposed to a plain
  // unanswered PENDING/REVISIONS item. Lets consumers (NotificationBell,
  // ClientHome) group/style these distinctly without re-deriving the split.
  isFlagged: boolean;
  // The completion row's own id, if one exists yet (null when no row has
  // ever been created for this item) — responding upserts on this.
  completionId: string | null;
  // What "how long it's been pending" is measured from: the completion
  // row's updated_at if one exists (i.e. it was set to PENDING/REVISIONS at
  // some point after creation), otherwise the item's own created_at (i.e.
  // it's been silently unaddressed since the checklist was seeded).
  pendingSinceISO: string;
}

// Raw shape PostgREST returns for the nested embed — this repo has no
// generated Supabase types (see upcomingTasks.ts's identical note), so this
// documents the actual shape rather than leaving it untyped. The
// dependency_completions embed is to-one (item_id is UNIQUE) but different
// PostgREST versions represent a to-one reverse-FK embed as either a single
// object or a one-element array — normalizeCompletion() below handles both
// rather than assuming one.
interface RawItemRow {
  id: string;
  item_label: string;
  created_at: string;
  task: {
    id: string;
    task_id: string;
    task_name: string;
    work: {
      name: string;
      code: string;
      project: { id: string; name: string } | null;
    } | null;
  } | null;
  completion:
    | { id: string; status: string; updated_at: string }
    | { id: string; status: string; updated_at: string }[]
    | null;
}

function normalizeCompletion(
  raw: RawItemRow['completion']
): { id: string; status: string; updated_at: string } | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function toCriticalAlert(row: RawItemRow): CriticalAlert | null {
  // tasks is soft-deleted (deletedAt), and this app never reads that
  // column — a task pulled back at all through the RLS-scoped join is, by
  // construction, one PostgREST could see, but a bulk-deleted task's row
  // still physically exists. Filtering here would need deleted_at
  // selected explicitly; omitted deliberately for this first pass since
  // soft-deleted tasks are rare and a stale alert is a visible, harmless
  // false positive rather than a silent miss — flagged for follow-up, not
  // treated as solved.
  if (!row.task || !row.task.work || !row.task.work.project) return null;
  if (!isPilotVisible(row.task.task_id, row.task.work.code)) return null;
  const completion = normalizeCompletion(row.completion);
  const status = (completion?.status as NeedsAttentionStatus | undefined) ?? 'PENDING';
  if (!NEEDS_ATTENTION_STATUSES.includes(status)) return null;

  return {
    itemId: row.id,
    itemLabel: row.item_label,
    taskId: row.task.id,
    taskName: row.task.task_name,
    workName: row.task.work.name,
    workCode: row.task.work.code,
    projectId: row.task.work.project.id,
    projectName: row.task.work.project.name,
    status,
    isFlagged: FLAGGED_STATUSES.includes(status),
    completionId: completion?.id ?? null,
    pendingSinceISO: completion?.updated_at ?? row.created_at,
  };
}

const SELECT = `
  id, item_label, created_at,
  task:tasks!inner(
    id, task_id, task_name,
    work:works!inner(name, code, project:projects!inner(id, name))
  ),
  completion:dependency_completions(id, status, updated_at)
`;

// Client's own view — RLS already scopes this to their own clientProjectId
// (dependency_items policy joins through to the caller's own project), so
// no project filter is needed or even possible from the client side of
// this call; the database enforces it regardless of what's asked for.
export async function fetchClientCriticalAlerts(): Promise<CriticalAlert[]> {
  const { data, error } = await supabase
    .from('dependency_items')
    .select(SELECT)
    .eq('category', 'client')
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawItemRow[])
    .map(toCriticalAlert)
    .filter((a): a is CriticalAlert => a !== null);
}

// Staff view — RLS grants staff unrestricted SELECT, so this naturally
// returns every project's pending client-category items; sort by
// longest-pending first (oldest pendingSinceISO), matching the "chase down
// slow responses" use case from the spec, done client-side since the two
// possible "pending since" sources (completion.updated_at vs item's own
// created_at) aren't a single sortable column at the query level.
export async function fetchAllPendingClientAlerts(): Promise<CriticalAlert[]> {
  const { data, error } = await supabase
    .from('dependency_items')
    .select(SELECT)
    .eq('category', 'client');

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawItemRow[])
    .map(toCriticalAlert)
    .filter((a): a is CriticalAlert => a !== null)
    .sort((a, b) => new Date(a.pendingSinceISO).getTime() - new Date(b.pendingSinceISO).getTime());
}

// The client's respond action — a completion row may or may not exist yet
// for this item (see the module doc comment), so this upserts rather than
// assuming UPDATE will match a row. RLS's INSERT/UPDATE policies both
// require category='client' AND the item's project to match the caller's
// own clientProjectId, so this can only ever succeed for the caller's own
// project's client-category items regardless of what itemId is passed in.
export async function respondToClientAlert(
  itemId: string,
  status: 'YES' | 'NO' | 'PROCEED',
  completedByUserId: string,
  comment?: string
): Promise<void> {
  const { error } = await supabase
    .from('dependency_completions')
    .upsert(
      {
        item_id: itemId,
        status,
        comment: comment ?? null,
        completed_by: completedByUserId,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'item_id' }
    );

  if (error) throw new Error(error.message);
}
