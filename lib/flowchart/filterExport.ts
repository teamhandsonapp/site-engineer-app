import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatDateLabel } from '../formatTime';
import type { FlowchartTask } from './types';

// Filter panel's own PDF/Print — a plain list of whichever tasks the
// current Floor/Department/Room filter matched, by explicit request
// ("download that into PDF and print also both format"). Same expo-print/
// expo-sharing/SAF-save mechanics as lib/reports/qualityChecklistPdf.ts,
// copied rather than shared since that document's own signoff-block
// structure has nothing in common with a flat task list.

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface FilterSummary {
  floor: string | null; // null = "All floors"
  department: string | null; // null = "All departments"
  room: string | null; // null = "All rooms"
  milestone: string | null; // milestone NAME (already resolved by the caller), null = "All milestones"
  plannedDate: string | null; // pre-formatted label, e.g. "Supposed to start: Sep 10 – Sep 16", null = no date filter active
}

function summaryLine(summary: FilterSummary): string {
  const parts = [
    `Floor: ${summary.floor ?? 'All'}`,
    `Department: ${summary.department ?? 'All'}`,
    `Room: ${summary.room ?? 'All'}`,
    `Milestone: ${summary.milestone ?? 'All'}`,
  ];
  if (summary.plannedDate) parts.push(summary.plannedDate);
  return parts.join(' · ');
}

function buildHtml(tasks: FlowchartTask[], summary: FilterSummary): string {
  const rows = tasks.length
    ? tasks
        .map(
          (t) => `
            <tr>
              <td>${esc(t.taskName)}</td>
              <td>${esc(t.workName)}</td>
              <td>${esc(t.floorLevel ?? '—')}</td>
              <td>${esc(t.roomType ?? '—')}</td>
              <td class="num">${esc(t.plannedStartDate ?? '—')}</td>
              <td class="num">${esc(t.dueDate ?? '—')}</td>
            </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="empty">No tasks match this filter.</td></tr>`;

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111827; padding: 24px; }
          h1 { font-size: 18px; margin: 0 0 2px; }
          .sub { color: #6B7280; font-size: 12px; margin: 0 0 20px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { text-align: left; padding: 6px 4px; border-bottom: 2px solid #E5E7EB; font-size: 10px; color: #9CA3AF; text-transform: uppercase; }
          td { padding: 7px 4px; border-bottom: 1px solid #F3F4F6; }
          td.num, th.num { text-align: right; }
          td.empty { color: #9CA3AF; font-style: italic; text-align: center; }
        </style>
      </head>
      <body>
        <h1>Flowchart Filter — Task List</h1>
        <p class="sub">${esc(summaryLine(summary))} · ${tasks.length} task${tasks.length === 1 ? '' : 's'} · Generated ${formatDateLabel(new Date())}</p>
        <table>
          <tr><th>Task</th><th>Department</th><th>Floor</th><th>Room</th><th class="num">Planned Start</th><th class="num">Planned End</th></tr>
          ${rows}
        </table>
      </body>
    </html>
  `;
}

const SAVE_DIR_KEY = 'flowchartFilter:pdfSaveDirectoryUri';

function friendlyDirLabel(treeUri: string): string {
  const encoded = treeUri.split('/tree/')[1];
  if (!encoded) return 'the folder you selected';
  return decodeURIComponent(encoded).replace(/^primary:/, 'Internal storage/').replace(/:/g, '/');
}

async function pickSaveDirectory(): Promise<string> {
  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) {
    throw new Error('Pick a folder to save the PDF into.');
  }
  await AsyncStorage.setItem(SAVE_DIR_KEY, permissions.directoryUri);
  return permissions.directoryUri;
}

async function getSaveDirectory(): Promise<string> {
  const stored = await AsyncStorage.getItem(SAVE_DIR_KEY);
  return stored ?? (await pickSaveDirectory());
}

// "Download PDF" — saves a file (Android: picked folder via SAF; iOS: the
// share sheet, same split as qualityChecklistPdf.ts's own export).
export async function exportFilteredTasksPdf(tasks: FlowchartTask[], summary: FilterSummary): Promise<string> {
  const html = buildHtml(tasks, summary);
  const fileName = 'flowchart-filter-tasks';

  if (Platform.OS === 'android') {
    const { base64 } = await Print.printToFileAsync({ html, base64: true });
    if (!base64) {
      throw new Error('Could not generate the PDF.');
    }
    let directoryUri = await getSaveDirectory();
    let destUri: string;
    try {
      destUri = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, fileName, 'application/pdf');
    } catch {
      directoryUri = await pickSaveDirectory();
      destUri = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, fileName, 'application/pdf');
    }
    await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return friendlyDirLabel(directoryUri);
  }

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error("Sharing isn't available on this device.");
  }
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Flowchart Filter — Task List', UTI: 'com.adobe.pdf' });
  return '';
}

// "Print" — a distinct action from Download PDF, by explicit request ("both
// format"): opens the native print dialog directly (expo-print's own
// printAsync) instead of a saved file's share sheet.
export async function printFilteredTasks(tasks: FlowchartTask[], summary: FilterSummary): Promise<void> {
  const html = buildHtml(tasks, summary);
  await Print.printAsync({ html });
}
