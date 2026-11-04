import { supabase } from './supabase';
import { isPilotVisible } from './pilot';

// Mirrors admin-web's threaded Comment model (prisma/schema.prisma, table
// `comments`) — a checklist-item-scoped comment thread, distinct from the
// old plain-text `dependency_completions.comment` field this app already
// reads elsewhere (see respondToClientAlert in dependencyAlerts.ts). This
// is the first time this app reads the newer Comment table.
export interface TaskComment {
  id: string;
  body: string;
  createdAtISO: string;
  authorName: string | null;
  taskId: string; // tasks.id (uuid)
  taskCode: string; // tasks.task_id (human-readable code, e.g. "1a")
  taskName: string;
  itemLabel: string;
  workName: string;
  workCode: string;
  projectId: string | null;
  projectName: string | null;
}

// Raw shape PostgREST returns for the nested embed — this repo has no
// generated Supabase types (see dependencyAlerts.ts/upcomingTasks.ts's
// identical note).
interface RawCommentRow {
  id: string;
  body: string;
  created_at: string;
  author: { full_name: string } | { full_name: string }[] | null;
  item: {
    item_label: string;
    task: {
      id: string;
      task_id: string;
      task_name: string;
      work: { name: string; code: string; project: { id: string; name: string } | null } | null;
    } | null;
  } | null;
}

function normalizeAuthor(raw: RawCommentRow['author']): { full_name: string } | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function toTaskComment(row: RawCommentRow): TaskComment | null {
  if (!row.item || !row.item.task) return null;
  if (!isPilotVisible(row.item.task.task_id, row.item.task.work?.code)) return null;
  const author = normalizeAuthor(row.author);
  return {
    id: row.id,
    body: row.body,
    createdAtISO: row.created_at,
    authorName: author?.full_name ?? null,
    taskId: row.item.task.id,
    taskCode: row.item.task.task_id,
    taskName: row.item.task.task_name,
    itemLabel: row.item.item_label,
    workName: row.item.task.work?.name ?? 'Unknown trade',
    workCode: row.item.task.work?.code ?? '—',
    projectId: row.item.task.work?.project?.id ?? null,
    projectName: row.item.task.work?.project?.name ?? null,
  };
}

const SELECT = `
  id, body, created_at,
  author:user_profiles(full_name),
  item:dependency_items!inner(
    item_label,
    task:tasks!inner(id, task_id, task_name, work:works(name, code, project:projects(id, name)))
  )
`;

// Staff-wide, unscoped by project — same convention fetchUpcomingTasks()
// already uses (see NotificationBell.tsx's file comment on why the bell is
// staff-only): a comment on any task, in any project, is exactly the kind
// of thing a site engineer should be alerted to regardless of which
// project they currently have open. Newest first, capped at `limit` since
// this is an alerts feed, not a full history browser.
export async function fetchRecentComments(limit = 50): Promise<TaskComment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawCommentRow[])
    .map(toTaskComment)
    .filter((c): c is TaskComment => c !== null);
}
