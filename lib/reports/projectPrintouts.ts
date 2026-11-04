import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { CATEGORIES, CATEGORY_LABEL, type DependencyCategory } from '../taskDetail/constants';
import { fetchGlobalTemplateItems } from '../taskDetail/globalChecklist';
import { formatDateLabel } from '../formatTime';
import { QUALITY_CATEGORIES, QUALITY_DEFAULT_ITEM_LABELS } from '../dprChecklist';

// A4 printouts requested by the client, reachable from project Settings:
//  1. Prerequisites List — the master checklist every task is created with
//     (dependency_template_items), grouped by category, with blank
//     Received / Remarks columns to fill in by hand.
//  2. Procurement Types — every task_types row (Type 1..N) with its lead
//     time, plus this project's tasks assigned to each type.
// Each can be previewed, downloaded as PDF, or sent (share sheet) to the
// client. Same expo-print / expo-sharing / Android SAF mechanics as
// qualityChecklistPdf.ts; web has no PDF writer, so it opens the A4 page in
// a new tab with the browser's print dialog ("Save as PDF").

// A4 in PostScript points — expo-print's default page is US Letter on iOS.
const A4 = { width: 595, height: 842 };

export type PrintoutKind = 'prerequisites' | 'procurement' | 'quality';

export const PRINTOUT_TITLE: Record<PrintoutKind, string> = {
  prerequisites: 'Prerequisites List',
  procurement: 'Procurement Types',
  quality: 'Quality Checklist',
};

// "Type 1".."Type 7" are shown as "Type A".."Type G" on the printout, by
// explicit request (display only — the stored task_types names are unchanged).
function typeLabel(name: string): string {
  const m = /^Type\s+(\d+)$/i.exec(name.trim());
  return m ? `Type ${String.fromCharCode(64 + Number(m[1]))}` : name;
}

export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const A4_STYLE = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111827; margin: 0; padding: 0; font-size: 12px; }
  .sheet { max-width: 182mm; margin: 0 auto; }
  .brand { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0F1F33; padding-bottom: 8px; margin-bottom: 14px; }
  .brand .logo { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: #0F1F33; }
  .brand .meta { font-size: 10px; color: #6B7280; text-align: right; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: #6B7280; font-size: 11px; margin: 0 0 16px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #0F1F33; margin: 18px 0 6px; background: #F1F5F9; padding: 5px 8px; border-radius: 3px; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th { text-align: left; padding: 5px 6px; border-bottom: 1.5px solid #CBD5E1; font-size: 9.5px; color: #64748B; text-transform: uppercase; letter-spacing: 0.04em; }
  td { padding: 6px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
  td.num, th.num { text-align: right; }
  td.box { width: 18mm; text-align: center; }
  td.box span { display: inline-block; width: 11px; height: 11px; border: 1.2px solid #475569; border-radius: 2px; }
  td.remarks { width: 48mm; }
  td.empty { color: #9CA3AF; font-style: italic; }
  .foot { margin-top: 28px; display: flex; justify-content: space-between; gap: 24px; }
  .sign { flex: 1; }
  .sign .line { margin-top: 34px; border-top: 1px solid #111827; }
  .sign .label { font-size: 10px; color: #6B7280; margin-top: 4px; }
`;

export function page(title: string, projectName: string, body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${esc(title)} — ${esc(projectName)}</title>
    <style>${A4_STYLE}</style>
  </head>
  <body>
    <div class="sheet">
      <div class="brand">
        <div class="logo">PMC PORTAL</div>
        <div class="meta">${esc(projectName)}<br/>Generated ${esc(formatDateLabel(new Date()))}</div>
      </div>
      <h1>${esc(title)}</h1>
      ${body}
      <div class="foot">
        <div class="sign"><div class="line"></div><div class="label">Prepared by (PMC)</div></div>
        <div class="sign"><div class="line"></div><div class="label">Client acknowledgement &amp; date</div></div>
      </div>
    </div>
  </body>
</html>`;
}

async function buildPrerequisitesHtml(projectName: string): Promise<string> {
  const items = await fetchGlobalTemplateItems();
  // 'quantity' is a measurement, not a prerequisite — same exclusion the
  // DPR Pending tab's own prerequisite summary makes.
  // Categories with no items at all (e.g. the quality ones) are left off the page.
  const cats = CATEGORIES.filter((c) => c !== 'quantity' && items.some((i) => i.category === c));
  let n = 0;
  const sections = cats
    .map((cat: DependencyCategory) => {
      const rows = items.filter((i) => i.category === cat);
      const body = rows.length
        ? rows
            .map((r) => {
              n += 1;
              return `<tr><td style="width:9mm">${n}</td><td>${esc(r.label)}</td><td class="box"><span></span></td><td class="remarks"></td></tr>`;
            })
            .join('')
        : `<tr><td colspan="4" class="empty">No items in this category.</td></tr>`;
      return `<h2>${esc(CATEGORY_LABEL[cat])}</h2>
        <table>
          <tr><th>#</th><th>Prerequisite</th><th class="num" style="text-align:center">Received</th><th>Remarks</th></tr>
          ${body}
        </table>`;
    })
    .join('');
  return page(
    'Prerequisites List',
    projectName,
    `<p class="sub">Inputs required before work can start on each task, grouped by who provides them. Tick "Received" and add remarks as each item comes in.</p>${sections}`
  );
}

interface RawTypedTask {
  task_id: string;
  task_name: string;
  task_type_id: string | null;
  planned_start_date: string | null;
  current_planned_start_date: string | null;
  work: { name: string } | { name: string }[] | null;
}

async function buildProcurementHtml(projectId: string, projectName: string): Promise<string> {
  const [{ data: types, error: typesErr }, { data: tasks, error: tasksErr }] = await Promise.all([
    supabase.from('task_types').select('id, name, default_duration_days').order('default_duration_days', { ascending: true }),
    supabase
      .from('tasks')
      .select('task_id, task_name, task_type_id, planned_start_date, current_planned_start_date, work:works!inner(name, project_id)')
      .eq('work.project_id', projectId)
      .is('deleted_at', null)
      .not('task_type_id', 'is', null),
  ]);
  if (typesErr) throw new Error(typesErr.message);
  if (tasksErr) throw new Error(tasksErr.message);
  const typed = (tasks ?? []) as unknown as RawTypedTask[];

  const summaryRows = (types ?? [])
    .map((t) => {
      const count = typed.filter((x) => x.task_type_id === t.id).length;
      return `<tr><td><b>${esc(typeLabel(t.name))}</b></td><td class="num">${t.default_duration_days} days</td><td>Place order at least ${t.default_duration_days} days before the task's planned start</td><td class="num">${count}</td></tr>`;
    })
    .join('');

  const perType = (types ?? [])
    .map((t) => {
      const list = typed.filter((x) => x.task_type_id === t.id);
      const rows = list.length
        ? list
            .map((x) => {
              const start = x.current_planned_start_date ?? x.planned_start_date;
              let orderBy = '—';
              if (start) {
                const d = new Date(`${start}T00:00:00`);
                d.setDate(d.getDate() - t.default_duration_days);
                orderBy = formatDateLabel(d);
              }
              const work = Array.isArray(x.work) ? x.work[0] : x.work;
              return `<tr><td>${esc(x.task_id)}</td><td>${esc(x.task_name)}</td><td>${esc(work?.name ?? '')}</td><td class="num">${start ? esc(formatDateLabel(new Date(`${start}T00:00:00`))) : '—'}</td><td class="num"><b>${esc(orderBy)}</b></td></tr>`;
            })
            .join('')
        : `<tr><td colspan="5" class="empty">No tasks on this project use ${esc(typeLabel(t.name))} yet.</td></tr>`;
      return `<h2>${esc(typeLabel(t.name))} — ${t.default_duration_days} day lead time</h2>
        <table>
          <tr><th>Code</th><th>Task</th><th>Department</th><th class="num">Planned start</th><th class="num">Order by</th></tr>
          ${rows}
        </table>`;
    })
    .join('');

  return page(
    'Procurement Types',
    projectName,
    `<p class="sub">Each procurement type sets how many days before a task's start its materials must be ordered.</p>
     <table>
       <tr><th>Type</th><th class="num">Lead time</th><th>Rule</th><th class="num">Tasks</th></tr>
       ${summaryRows}
     </table>
     ${perType}`
  );
}

function buildQualityHtml(projectName: string): string {
  const QUALITY_TITLE: Record<string, string> = {
    quality_pre_construction: 'Pre Construction',
    quality_construction: 'Construction',
    quality_post_construction: 'Post Construction',
  };
  let n = 0;
  const sections = QUALITY_CATEGORIES.map((cat) => {
    const rows = QUALITY_DEFAULT_ITEM_LABELS[cat]
      .map((label) => {
        n += 1;
        return `<tr><td style="width:9mm">${n}</td><td>${esc(label)}</td><td class="box" style="width:12mm"><span></span></td><td class="box" style="width:12mm"><span></span></td><td class="box" style="width:12mm"><span></span></td><td class="remarks" style="width:40mm"></td></tr>`;
      })
      .join('');
    return `<h2>${esc(QUALITY_TITLE[cat])}</h2>
      <table>
        <tr><th>#</th><th>Check</th><th style="text-align:center">Yes</th><th style="text-align:center">No</th><th style="text-align:center">N/A</th><th>Remarks</th></tr>
        ${rows}
      </table>`;
  }).join('');
  const field = (label: string) => `<td style="border:none;padding:4px 0;width:50%"><span style="font-size:10px;color:#6B7280">${label}</span><div style="border-bottom:1px solid #94A3B8;height:18px"></div></td>`;
  return page(
    'Quality Checklist',
    projectName,
    `<p class="sub">To be filled on site for each pour / activity and signed by the contractor and site engineer.</p>
     <table style="margin-bottom:6px"><tr>${field('Task / Activity')}${field('Location / Floor')}</tr><tr>${field('Date')}${field('Contractor')}</tr></table>
     ${sections}`
  );
}

export async function buildPrintoutHtml(kind: PrintoutKind, projectId: string, projectName: string): Promise<string> {
  if (kind === 'prerequisites') return buildPrerequisitesHtml(projectName);
  if (kind === 'quality') return buildQualityHtml(projectName);
  return buildProcurementHtml(projectId, projectName);
}

// Web: open the A4 page in its own tab; `autoPrint` also opens the print
// dialog there (where "Save as PDF" is the download).
function openWebWindow(html: string, autoPrint: boolean) {
  const w = window.open('', '_blank');
  if (!w) throw new Error('Allow pop-ups for this site to open the printout.');
  w.document.open();
  w.document.write(autoPrint ? html.replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body>') : html);
  w.document.close();
}

export async function previewPrintout(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    openWebWindow(html, false);
    return;
  }
  // Native print dialog shows a full A4 page preview.
  await Print.printAsync({ html, ...A4 });
}

const SAVE_DIR_KEY = 'projectPrintouts:pdfSaveDirectoryUri';

function friendlyDirLabel(treeUri: string): string {
  const encoded = treeUri.split('/tree/')[1];
  if (!encoded) return 'the folder you selected';
  return decodeURIComponent(encoded).replace(/^primary:/, 'Internal storage/').replace(/:/g, '/');
}

async function pickSaveDirectory(): Promise<string> {
  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) throw new Error('Pick a folder to save the PDF into.');
  await AsyncStorage.setItem(SAVE_DIR_KEY, permissions.directoryUri);
  return permissions.directoryUri;
}

// Returns a human-readable "saved to" note ('' when a share sheet handled it).
export async function downloadPrintout(html: string, fileName: string): Promise<string> {
  const safeName = fileName.replace(/[^a-zA-Z0-9-_]/g, '_');
  if (Platform.OS === 'web') {
    openWebWindow(html, true);
    return 'Choose "Save as PDF" in the print window.';
  }
  if (Platform.OS === 'android') {
    const { base64 } = await Print.printToFileAsync({ html, base64: true, ...A4 });
    if (!base64) throw new Error('Could not generate the PDF.');
    let directoryUri = (await AsyncStorage.getItem(SAVE_DIR_KEY)) ?? (await pickSaveDirectory());
    let destUri: string;
    try {
      destUri = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, safeName, 'application/pdf');
    } catch {
      directoryUri = await pickSaveDirectory();
      destUri = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, safeName, 'application/pdf');
    }
    await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return `Saved to ${friendlyDirLabel(directoryUri)}`;
  }
  await sharePrintout(html, fileName);
  return '';
}

// "Send to Client" — the system share sheet (WhatsApp, Gmail, etc.) with
// the PDF attached. Web can't attach a generated file, so it falls back to
// the print window for "Save as PDF", then attach it manually.
export async function sharePrintout(html: string, title: string): Promise<string> {
  if (Platform.OS === 'web') {
    openWebWindow(html, true);
    return 'Save as PDF, then attach it to your email or WhatsApp.';
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false, ...A4 });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  return '';
}
