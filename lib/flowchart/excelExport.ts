import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as XLSX from 'xlsx';
import { countWorkingDaysBetween, workingDaysBetween } from '../workingDays';
import { fetchBlockedDates } from '../reports/generalParameterReport';
import type { FlowchartTask } from './types';
import { fetchChecklistNotesForTasks, type ChecklistNoteKey, type ChecklistNotes } from './checklistNotes';

// Flowchart "Excel" download (by client request, 2026-11-10): one row per
// task with Task ID, Task Name, Planned Start/End, Actual Start/End, the
// three delay stages (Pre Construction, Construction, Post Construction =
// Pre + Construction, same as the task report) and an empty Delay Reason
// column for the client to fill in.
// A real .xlsx, so it opens in Excel and imports straight into Google Sheets.
// Rows follow the flowchart's own order (Actual Start, no date last).

const HEADERS = [
  'Task ID',
  'Task Name',
  'Planned Start Date',
  'Planned End Date',
  'Actual Start Date',
  'Actual End Date',
  'Pre Construction Delay (days)',
  'Construction Delay (days)',
  'Post Construction Delay (days)',
  'Delay Reason',
];
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SAVE_DIR_KEY = 'flowchartExcel:saveDirectoryUri';

function parseKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

// Same three stages as the task report (generalParameterReport.ts):
// Pre = working days Planned Start -> Actual Start (0 if started early),
// Construction = actual working days - planned working days (never < 0),
// Post = Pre + Construction.
function delayStages(t: FlowchartTask, blocked: Set<string>, todayKey: string): { pre: number; construction: number; post: number } | null {
  if (!t.plannedStartDate || !t.dueDate || !t.actualStartDate) return null;
  const plannedStart = parseKey(t.plannedStartDate);
  const actualStart = parseKey(t.actualStartDate);
  const pre = actualStart > plannedStart ? Math.max(0, workingDaysBetween(plannedStart, actualStart, blocked)) : 0;
  const planned = countWorkingDaysBetween(plannedStart, parseKey(t.dueDate), blocked);
  const actual = countWorkingDaysBetween(actualStart, parseKey(t.actualEndDate ?? todayKey), blocked);
  const construction = Math.max(0, actual - planned);
  return { pre, construction, post: pre + construction };
}

function numberCell(n: number | undefined): XLSX.CellObject {
  return n == null ? { t: 's', v: '' } : { t: 'n', v: n };
}

// Rows follow the flowchart as drawn: top to bottom, then left to right — so
// the main column comes first (already in Actual Start / Planned End order)
// and a separate row of parallel tasks below it comes after, left to right.
// Tasks with no saved position go last, by date.
function cmpDateKey(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function byActualStart(a: FlowchartTask, b: FlowchartTask): number {
  const ay = a.manualPositionY ?? Number.MAX_SAFE_INTEGER;
  const by = b.manualPositionY ?? Number.MAX_SAFE_INTEGER;
  if (ay !== by) return ay - by;
  const ax = a.manualPositionX ?? Number.MAX_SAFE_INTEGER;
  const bx = b.manualPositionX ?? Number.MAX_SAFE_INTEGER;
  if (ax !== bx) return ax - bx;
  const aStarted = !!a.actualStartDate;
  const bStarted = !!b.actualStartDate;
  if (aStarted !== bStarted) return aStarted ? -1 : 1;
  const byDate = aStarted ? cmpDateKey(a.actualStartDate, b.actualStartDate) : cmpDateKey(a.dueDate, b.dueDate);
  return byDate || a.taskName.localeCompare(b.taskName, undefined, { numeric: true });
}

// A real date cell (sorts/filters as a date in Excel and Google Sheets),
// shown as "1 Sep 26" — by request, 2026-11-10 (no slashes).
function dateCell(key: string | null): XLSX.CellObject {
  if (!key) return { t: 's', v: '' };
  const [y, m, d] = key.split('-').map(Number);
  return { t: 'd', v: new Date(y, m - 1, d), z: 'd mmm yy' };
}

export async function buildFlowchartWorkbook(tasks: FlowchartTask[], projectName: string): Promise<XLSX.WorkBook> {
  const todayKey = new Date().toISOString().slice(0, 10);
  const keys = tasks.flatMap((t) => [t.plannedStartDate, t.dueDate, t.actualStartDate, t.actualEndDate, todayKey]);
  const years = new Set(keys.filter((k): k is string => !!k).map((k) => Number(k.slice(0, 4))));
  const blocked = await fetchBlockedDates(years);

  const rows: XLSX.CellObject[][] = [...tasks].sort(byActualStart).map((t) => {
    const delay = delayStages(t, blocked, todayKey);
    return [
      { t: 's', v: t.taskId },
      { t: 's', v: t.taskName },
      dateCell(t.plannedStartDate),
      dateCell(t.dueDate),
      dateCell(t.actualStartDate),
      dateCell(t.actualEndDate),
      numberCell(delay?.pre),
      numberCell(delay?.construction),
      numberCell(delay?.post),
      { t: 's', v: '' },
    ];
  });

  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows] as unknown as unknown[][], { cellDates: true });
  sheet['!cols'] = [{ wch: 14 }, { wch: 55 }, { wch: 18 }, { wch: 17 }, { wch: 17 }, { wch: 16 }, { wch: 27 }, { wch: 24 }, { wch: 28 }, { wch: 40 }];
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, (projectName || 'Tasks').replace(/[\\/?*[\]:]/g, '').slice(0, 31));
  return book;
}

function friendlyDirLabel(treeUri: string): string {
  const encoded = treeUri.split('/tree/')[1];
  if (!encoded) return 'the folder you selected';
  return decodeURIComponent(encoded).replace(/^primary:/, 'Internal storage/').replace(/:/g, '/');
}

async function pickSaveDirectory(): Promise<string> {
  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) throw new Error('Pick a folder to save the Excel file into.');
  await AsyncStorage.setItem(SAVE_DIR_KEY, permissions.directoryUri);
  return permissions.directoryUri;
}

// Flowchart 2 "Checklist Excel" (client request, 2026-11-14): one row per
// task — Task Name, Department (blank if none), Planned Start, Actual Start —
// then the client's checklist points (Architect and Consultant as separate
// columns, like the client's own sheet) as wide, tall cells, PRE-FILLED with
// what's saved in the app (task_checklist_notes) so the client only updates
// what changed.
export const CHECKLIST_POINTS: { header: string; key: ChecklistNoteKey }[] = [
  { header: 'Drawing Approval — Architect', key: 'architect' },
  { header: 'Drawing Approval — Consultant', key: 'consultant' },
  { header: 'Client Approval', key: 'client' },
  { header: 'Procurement Status', key: 'procurementStatus' },
  { header: 'Procurement Lead time', key: 'leadTime' },
  { header: 'Other Dependencies', key: 'other' },
];

export function buildChecklistWorkbook(tasks: FlowchartTask[], notes: Map<string, ChecklistNotes>): XLSX.WorkBook {
  const headers = ['S.No', 'Task Name', 'Department', 'Planned Start Date', 'Actual Start Date', ...CHECKLIST_POINTS.map((p) => p.header)];
  const rows: XLSX.CellObject[][] = [...tasks].sort(byActualStart).map((t, i) => [
    { t: 'n', v: i + 1 },
    { t: 's', v: t.taskName.trim() },
    { t: 's', v: t.workName && t.workName !== 'Unassigned' ? t.workName : '' },
    dateCell(t.plannedStartDate),
    dateCell(t.actualStartDate),
    ...CHECKLIST_POINTS.map((p): XLSX.CellObject => ({ t: 's', v: notes.get(t.id)?.[p.key] ?? '' })),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows] as unknown as unknown[][], { cellDates: true });
  // Big writing space: wide checklist columns and tall rows.
  sheet['!cols'] = [{ wch: 6 }, { wch: 48 }, { wch: 18 }, { wch: 17 }, { wch: 17 }, ...CHECKLIST_POINTS.map(() => ({ wch: 30 }))];
  sheet['!rows'] = [{ hpt: 30 }, ...rows.map(() => ({ hpt: 60 }))];
  sheet['!freeze'] = { xSplit: 2, ySplit: 1 };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Checklist');
  return book;
}

export async function exportChecklistExcel(tasks: FlowchartTask[], projectName: string): Promise<string> {
  const notes = await fetchChecklistNotesForTasks(tasks.map((t) => t.id));
  const book = buildChecklistWorkbook(tasks, notes);
  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `${(projectName || 'Project').replace(/[^\w@ -]+/g, '').trim()} - Flowchart 2 Checklist ${stamp}`;
  return saveWorkbook(book, baseName, 'Checklist (Excel)');
}

// Returns a short "saved to …" note ('' when the browser / share sheet
// already made the outcome obvious).
export async function exportFlowchartExcel(tasks: FlowchartTask[], projectName: string): Promise<string> {
  const book = await buildFlowchartWorkbook(tasks, projectName);
  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `${(projectName || 'Project').replace(/[^\w@ -]+/g, '').trim()} - Tasks ${stamp}`;
  return saveWorkbook(book, baseName, 'Tasks (Excel)');
}

async function saveWorkbook(book: XLSX.WorkBook, baseName: string, dialogTitle: string): Promise<string> {

  if (Platform.OS === 'web') {
    XLSX.writeFile(book, `${baseName}.xlsx`, { bookType: 'xlsx', cellDates: true });
    return '';
  }

  const base64 = XLSX.write(book, { type: 'base64', bookType: 'xlsx', cellDates: true }) as string;

  if (Platform.OS === 'android') {
    let directoryUri = (await AsyncStorage.getItem(SAVE_DIR_KEY)) ?? (await pickSaveDirectory());
    let destUri: string;
    try {
      destUri = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, baseName, XLSX_MIME);
    } catch {
      directoryUri = await pickSaveDirectory();
      destUri = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, baseName, XLSX_MIME);
    }
    await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return `Saved to ${friendlyDirLabel(directoryUri)}`;
  }

  const uri = `${FileSystem.cacheDirectory}${baseName}.xlsx`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(uri, { mimeType: XLSX_MIME, dialogTitle, UTI: 'org.openxmlformats.spreadsheetml.sheet' });
  return '';
}
