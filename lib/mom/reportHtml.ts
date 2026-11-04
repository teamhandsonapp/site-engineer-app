// A4 report pages (HTML -> PDF via expo-print) for the MoM Reports and
// Custom Alerts tabs. Reuses projectPrintouts.ts's page() shell + esc() so
// these look identical to the app's existing printouts.

import { esc, page } from '../reports/projectPrintouts';
import {
  TASK_STATUS_LABEL,
  computeProjectHealth,
  daysLate,
  isOverdue,
  pendingTasks,
  upcomingTasks,
  todayIST,
  UPCOMING_WINDOW_DAYS,
  type ProjectTask,
} from './taskData';
import { formatDateLong } from './share';

const d = (v: string | null) => (v ? esc(formatShort(v)) : '—');

function formatShort(date: string): string {
  const [y, m, day] = date.split('-');
  return `${day}/${m}/${y}`;
}

function taskTable(tasks: ProjectTask[], opts: { showLate?: boolean } = {}): string {
  if (tasks.length === 0) return '<table><tr><td class="empty">None</td></tr></table>';
  const rows = tasks
    .map(
      (t) => `<tr>
        <td>${esc(t.code)}</td>
        <td>${esc(t.name)}</td>
        <td>${esc(t.workName)}</td>
        <td>${esc(TASK_STATUS_LABEL[t.status] ?? t.status)}</td>
        <td>${d(t.plannedStart)}</td>
        <td>${d(t.due)}</td>
        ${opts.showLate ? `<td class="num">${isOverdue(t) ? daysLate(t) + ' d' : '—'}</td>` : ''}
      </tr>`
    )
    .join('');
  return `<table>
    <tr><th>Code</th><th>Task</th><th>Department</th><th>Status</th><th>Start</th><th>Due</th>${opts.showLate ? '<th class="num">Late</th>' : ''}</tr>
    ${rows}
  </table>`;
}

export function pendingUpcomingHtml(tasks: ProjectTask[], projectName: string, include: { pending: boolean; upcoming: boolean }): string {
  const today = todayIST();
  const parts: string[] = [`<p class="sub">As of ${esc(formatDateLong(today))}</p>`];
  if (include.pending) {
    const list = pendingTasks(tasks, today);
    parts.push(`<h2>Pending tasks (${list.length})</h2>`, taskTable(list, { showLate: true }));
  }
  if (include.upcoming) {
    const list = upcomingTasks(tasks, today);
    parts.push(`<h2>Upcoming tasks — next ${UPCOMING_WINDOW_DAYS} days (${list.length})</h2>`, taskTable(list));
  }
  const title = include.pending && include.upcoming ? 'Pending & Upcoming Tasks' : include.pending ? 'Pending Tasks' : 'Upcoming Tasks';
  return page(title, projectName, parts.join('\n'));
}

export function taskReportHtml(tasks: ProjectTask[], projectName: string, departments: string[] | null): string {
  const filtered = departments ? tasks.filter((t) => departments.includes(t.workName)) : tasks;
  const groups = new Map<string, ProjectTask[]>();
  for (const t of filtered) groups.set(t.workName, [...(groups.get(t.workName) ?? []), t]);
  const body = [
    `<p class="sub">As of ${esc(formatDateLong(todayIST()))} · ${filtered.length} tasks${departments ? ` · ${departments.length} department(s)` : ''}</p>`,
    ...Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([work, list]) => {
        const done = list.filter((t) => t.status === 'completed').length;
        return `<h2>${esc(work)} — ${done}/${list.length} completed</h2>${taskTable(list, { showLate: true })}`;
      }),
  ];
  return page('Task Based Report', projectName, body.join('\n'));
}

export function projectHealthHtml(tasks: ProjectTask[], projectName: string, sftPercent: number | null): string {
  const h = computeProjectHealth(tasks);
  const statusRows = (Object.keys(h.byStatus) as (keyof typeof h.byStatus)[])
    .filter((s) => h.byStatus[s] > 0)
    .map((s) => `<tr><td>${esc(TASK_STATUS_LABEL[s])}</td><td class="num">${h.byStatus[s]}</td></tr>`)
    .join('');
  const deptRows = h.byDepartment
    .map(
      (r) =>
        `<tr><td>${esc(r.workName)}</td><td class="num">${r.total}</td><td class="num">${r.completed}</td><td class="num">${r.total ? Math.round((r.completed / r.total) * 100) : 0}%</td><td class="num">${r.overdue}</td></tr>`
    )
    .join('');
  const verdict = h.overdue.length === 0 ? 'On track' : h.overdue.length <= 3 ? 'Needs attention' : 'At risk';
  const body = `
    <p class="sub">As of ${esc(formatDateLong(todayIST()))}</p>
    <h2>Summary</h2>
    <table>
      <tr><td>Overall status</td><td class="num"><b>${verdict}</b></td></tr>
      <tr><td>Tasks completed</td><td class="num">${h.byStatus.completed} of ${h.total} (${h.completedPercent}%)</td></tr>
      ${sftPercent != null ? `<tr><td>Built-up area completed (SFT)</td><td class="num">${sftPercent}%</td></tr>` : ''}
      <tr><td>Overdue tasks</td><td class="num">${h.overdue.length}</td></tr>
      <tr><td>Pending tasks</td><td class="num">${h.pending.length}</td></tr>
      <tr><td>Starting in the next ${UPCOMING_WINDOW_DAYS} days</td><td class="num">${h.upcoming.length}</td></tr>
    </table>
    <h2>Tasks by status</h2>
    <table><tr><th>Status</th><th class="num">Tasks</th></tr>${statusRows || '<tr><td class="empty">No tasks</td></tr>'}</table>
    <h2>By department</h2>
    <table><tr><th>Department</th><th class="num">Tasks</th><th class="num">Done</th><th class="num">%</th><th class="num">Overdue</th></tr>${deptRows || '<tr><td class="empty">No departments</td></tr>'}</table>
    <h2>Overdue tasks (${h.overdue.length})</h2>
    ${taskTable(h.overdue, { showLate: true })}
    <h2>Upcoming — next ${UPCOMING_WINDOW_DAYS} days (${h.upcoming.length})</h2>
    ${taskTable(h.upcoming)}
  `;
  return page('Project Health Report', projectName, body);
}

// Plain-text version for WhatsApp / email body (no attachment support in
// a wa.me / mailto link).
export function taskListText(tasks: ProjectTask[], projectName: string, include: { pending: boolean; upcoming: boolean }): string {
  const today = todayIST();
  const line = (t: ProjectTask) =>
    `• ${t.name} (${t.workName})${t.due ? ` — due ${formatShort(t.due)}` : t.plannedStart ? ` — starts ${formatShort(t.plannedStart)}` : ''}${isOverdue(t, today) ? ` ⚠ ${daysLate(t, today)}d late` : ''}`;
  const out = [`${projectName} — task update (${formatDateLong(today)})`];
  if (include.pending) {
    const list = pendingTasks(tasks, today);
    out.push('', `*Pending tasks (${list.length})*`, ...(list.length ? list.map(line) : ['None']));
  }
  if (include.upcoming) {
    const list = upcomingTasks(tasks, today);
    out.push('', `*Upcoming — next ${UPCOMING_WINDOW_DAYS} days (${list.length})*`, ...(list.length ? list.map(line) : ['None']));
  }
  return out.join('\n');
}
