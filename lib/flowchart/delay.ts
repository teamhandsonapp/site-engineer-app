// Ported verbatim (same semantics, string-date inputs instead of Date) from
// admin-web/components/tasks/TaskDependencyGraph.tsx's `ownDelayDays()` —
// this is what admin-web's flowchart card ACTUALLY renders as its "+Xd"
// chip (confirmed by reading that file), not the separate CPM delay engine
// it also receives but doesn't use for this. A task's own actual-vs-planned
// gap takes priority when both exist — it's ground truth, cascade_delay_days
// is only an inherited estimate written when an upstream task's actual date
// pushes everything downstream.
export function ownDelayDays(task: {
  dueDate: string | null;
  plannedStartDate: string | null;
  actualEndDate: string | null;
  actualStartDate: string | null;
}): number | null {
  const dayGap = (from: string, to: string) =>
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

  if (task.dueDate && task.actualEndDate) {
    const g = dayGap(task.dueDate, task.actualEndDate);
    if (g > 0) return g;
  }
  if (task.plannedStartDate && task.actualStartDate) {
    const g = dayGap(task.plannedStartDate, task.actualStartDate);
    if (g > 0) return g;
  }
  return null;
}

export interface DelayChip {
  days: number;
  isOwnDelay: boolean; // true = real actual-date gap; false = inherited cascade estimate
}

export function resolveDelayChip(task: {
  dueDate: string | null;
  plannedStartDate: string | null;
  actualEndDate: string | null;
  actualStartDate: string | null;
  cascadeDelayDays: number | null;
}): DelayChip | null {
  const own = ownDelayDays(task);
  if (own !== null) {
    return { days: own, isOwnDelay: true };
  }
  if (task.cascadeDelayDays && task.cascadeDelayDays > 0) {
    return { days: task.cascadeDelayDays, isOwnDelay: false };
  }
  return null;
}

export function formatCardDate(date: string | null): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatCardDateRange(start: string | null, due: string | null): string {
  const startLabel = formatCardDate(start);
  const dueLabel = formatCardDate(due);
  if (startLabel && dueLabel) return `${startLabel} – ${dueLabel}`;
  if (startLabel) return startLabel;
  if (dueLabel) return dueLabel;
  return 'No planned dates';
}

// Distinct from formatCardDateRange above: returns null (not a "No planned
// dates"-style fallback string) when neither date exists, so the caller can
// use that to decide whether to render the actual-dates chip at all —
// unlike the planned-dates chip, which always renders with a fallback, the
// actual-dates chip is only ever shown when there's real actual data (see
// TaskNode.tsx). A trailing arrow (no closing date yet) reads as "started,
// still in progress" rather than a plain single date, which could
// otherwise be mistaken for a due date.
export function formatActualDateRange(start: string | null, end: string | null): string | null {
  const startLabel = formatCardDate(start);
  const endLabel = formatCardDate(end);
  if (startLabel && endLabel) return `${startLabel} – ${endLabel}`;
  if (startLabel) return `${startLabel} →`;
  if (endLabel) return `→ ${endLabel}`;
  return null;
}

// Ported from the same file's splitTaskName() — bulk-imported task names are
// "{section header} — {specific action}"; splitting keeps the section
// grouping visible as its own small muted line.
export function splitTaskName(name: string): { category: string | null; action: string } {
  const sepIdx = name.indexOf(' — ');
  if (sepIdx === -1) return { category: null, action: name };
  return { category: name.slice(0, sepIdx), action: name.slice(sepIdx + 3) };
}
