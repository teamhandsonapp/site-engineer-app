import { esc, page } from './projectPrintouts';
import { formatDateLabel, formatDayLabel, type DateRange } from './dateRange';
import { DPR_COMMENT_LABEL, DPR_DEPENDENCY_LABEL } from '../dprEntries';
import type { DprActivityReport, DprActivityRow, DprActivityTask, ProgressForecast } from './dprActivityReport';

// Daily/Weekly/Monthly/Custom Status as an A4 printout — the same task
// cards + cumulative rollup activity-report.tsx shows, as plain HTML so it
// goes through projectPrintouts.ts's downloadPrintout (web print window /
// Android folder save / iOS share sheet).

export type ForecastTone = 'normal' | 'late' | 'ok';

// The 3 numbered forecast lines, shared with activity-report.tsx's own
// ForecastLines so the screen and the PDF never word them differently.
export function forecastLines(f: ProgressForecast): { text: string; tone: ForecastTone }[] {
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  const line1 = `${f.percentDone}% done in ${days(f.daysElapsed)} (${formatDayLabel(f.startDate)} – ${formatDateLabel(f.asOfDate)})`;

  let line2: string;
  if (f.remainingPercent === 0) line2 = 'Completed — nothing remaining';
  else if (f.daysRemaining == null) line2 = `Remaining ${f.remainingPercent}% — no progress rate yet to project a finish`;
  else line2 = `Remaining ${f.remainingPercent}% will take ~${days(f.daysRemaining)}, till ${formatDateLabel(f.forecastEndDate)}`;

  let line3: { text: string; tone: ForecastTone };
  if (f.scheduledEndDate == null || f.varianceDays == null) {
    line3 = { text: f.scheduledEndDate == null ? 'No scheduled end date set' : `Scheduled end ${formatDateLabel(f.scheduledEndDate)}`, tone: 'normal' };
  } else if (f.varianceDays > 0) {
    line3 = { text: `Delayed by ${days(f.varianceDays)} vs schedule end ${formatDateLabel(f.scheduledEndDate)}`, tone: 'late' };
  } else {
    line3 = {
      text: `On track — ${f.varianceDays === 0 ? 'finishing on' : `${days(-f.varianceDays)} ahead of`} schedule end ${formatDateLabel(f.scheduledEndDate)}`,
      tone: 'ok',
    };
  }

  return [{ text: line1, tone: 'normal' }, { text: line2, tone: 'normal' }, line3];
}

export function entryNotes(row: DprActivityRow): string[] {
  return [
    ...row.dependencyCategories.map((c) => DPR_DEPENDENCY_LABEL[c]),
    ...(row.commentPreset ? [row.commentPreset === 'other' ? (row.commentText ?? 'Other') : DPR_COMMENT_LABEL[row.commentPreset]] : []),
  ];
}

const STYLE = `
  <style>
    .card { border: 1px solid #E5E7EB; border-radius: 5px; padding: 9px 11px; margin-bottom: 9px; page-break-inside: avoid; }
    .card .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .card .name { font-size: 13px; font-weight: 800; }
    .card .meta { font-size: 10px; color: #9CA3AF; margin-top: 1px; }
    .card .pct { font-size: 15px; font-weight: 800; color: #059669; }
    .fc { margin: 6px 0 4px; font-size: 10.5px; color: #4B5563; }
    .fc div { margin-top: 1px; }
    .fc .late { color: #DC2626; font-weight: 700; }
    .fc .ok { color: #059669; font-weight: 700; }
    .card td { padding: 4px 6px; font-size: 10.5px; }
    .card td.d { width: 18mm; color: #6B7280; font-weight: 600; }
    .card td.p { width: 14mm; color: #059669; font-weight: 700; }
    .card td.n { color: #6B7280; }
    .total { background: #171717; color: #fff; border-radius: 5px; padding: 10px 12px; margin-top: 4px; page-break-inside: avoid; }
    .total .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.55); font-weight: 700; }
    .total .v { font-size: 20px; font-weight: 800; margin: 2px 0; }
    .total .fc { color: rgba(255,255,255,0.85); }
    .total .fc .late { color: #FCA5A5; }
    .total .fc .ok { color: #6EE7B7; }
  </style>`;

function forecastHtml(f: ProgressForecast): string {
  return `<div class="fc">${forecastLines(f)
    .map((l, i) => `<div class="${l.tone === 'normal' ? '' : l.tone}"><b>${i + 1}.</b> ${esc(l.text)}</div>`)
    .join('')}</div>`;
}

function taskCard(task: DprActivityTask): string {
  const entries = task.entries
    .map(
      (row) => `<tr>
        <td class="d">${esc(formatDayLabel(row.reportDate))}</td>
        <td class="p">${row.percentComplete != null ? `${row.percentComplete}%` : '—'}</td>
        <td class="n">${esc(entryNotes(row).join(' · '))}</td>
      </tr>`
    )
    .join('');
  return `<div class="card">
    <div class="head">
      <div>
        <div class="name">${esc(task.taskName)}</div>
        <div class="meta">${esc(task.taskCode)} · ${esc(task.workName)} · ${task.entries.length} DPR${task.entries.length === 1 ? '' : 's'}</div>
      </div>
      ${task.forecast ? `<div class="pct">${task.forecast.percentDone}%</div>` : ''}
    </div>
    ${task.forecast ? forecastHtml(task.forecast) : ''}
    <table>${entries}</table>
  </div>`;
}

export function buildActivityReportPdfHtml(report: DprActivityReport, range: DateRange, projectName: string, title: string): string {
  return page(
    `${title} Report`,
    projectName,
    `${STYLE}
     <p class="sub">${esc(formatDateLabel(range.from))} – ${esc(formatDateLabel(range.to))} · ${report.taskCount} task${report.taskCount === 1 ? '' : 's'}</p>
     <h2>Task-Level Activity</h2>
     ${report.tasks.map(taskCard).join('')}
     <div class="total">
       <div class="k">Cumulative Progress</div>
       <div class="v">${report.cumulativePercent != null ? `${report.cumulativePercent}%` : '—'}</div>
       ${report.overallForecast ? forecastHtml(report.overallForecast) : ''}
     </div>`
  );
}
