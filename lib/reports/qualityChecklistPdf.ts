import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CATEGORY_LABEL, STATUS_CHIP } from '../taskDetail/constants';
import { formatDateLabel } from '../formatTime';
import { QUALITY_CATEGORIES, type QualityChecklist } from '../dprChecklist';

// Point 7's "Generate PDF" — a printable version of the task's quality
// checklist (Pre/Construction/Post Construction categories only), meant to
// be printed on-site and physically signed by the contractor, then
// photographed back in via uploadSignedChecklistPhoto. Same expo-print/
// expo-sharing mechanics as lib/reports/projectPrintouts.ts (the app's
// only other PDF), copied rather than shared since the two documents have
// nothing else in common.

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(checklist: QualityChecklist): string {
  const { task, itemsByCategory } = checklist;

  const sections = QUALITY_CATEGORIES.map((cat) => {
    const items = itemsByCategory[cat];
    const rows = items.length
      ? items
          .map(
            (item) => `
              <tr>
                <td>${esc(item.itemLabel)}</td>
                <td class="num">${esc(STATUS_CHIP[item.status].label)}</td>
              </tr>`
          )
          .join('')
      : `<tr><td colspan="2" class="empty">No checklist items defined for this category.</td></tr>`;
    return `
      <h2>${esc(CATEGORY_LABEL[cat])}</h2>
      <table>
        <tr><th>Item</th><th class="num">Status</th></tr>
        ${rows}
      </table>`;
  }).join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111827; padding: 24px; }
          h1 { font-size: 18px; margin: 0 0 2px; }
          .sub { color: #6B7280; font-size: 12px; margin: 0 0 20px; }
          h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6B7280; margin: 20px 0 8px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { text-align: left; padding: 5px 0; border-bottom: 2px solid #E5E7EB; font-size: 11px; color: #9CA3AF; text-transform: uppercase; }
          td { padding: 6px 0; border-bottom: 1px solid #F3F4F6; }
          td.num, th.num { text-align: right; }
          td.empty { color: #9CA3AF; font-style: italic; }
          .signoff { margin-top: 36px; padding-top: 16px; border-top: 1px solid #E5E7EB; }
          .signoff .line { margin-top: 40px; border-top: 1px solid #111827; width: 260px; }
          .signoff .label { font-size: 11px; color: #6B7280; margin-top: 4px; }
        </style>
      </head>
      <body>
        <h1>Quality Checklist — ${esc(task.taskCode)}</h1>
        <p class="sub">${esc(task.taskName)} · ${esc(task.workName)} · Generated ${formatDateLabel(new Date())}</p>

        ${sections}

        <div class="signoff">
          <p style="font-size:12px; color:#6B7280;">To be signed by the contractor on site after physical review, then photographed and uploaded back into the app.</p>
          <div class="line"></div>
          <p class="label">Contractor signature &amp; date</p>
        </div>
      </body>
    </html>
  `;
}

// Same folder-permission (Android) / share-sheet (iOS) split as
// generalParameterPdf.ts's exportGeneralParameterPdf — its own key, not
// shared, so the two features' remembered save folders don't clobber each
// other.
const SAVE_DIR_KEY = 'qualityChecklist:pdfSaveDirectoryUri';

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

export async function exportQualityChecklistPdf(checklist: QualityChecklist): Promise<string> {
  const html = buildHtml(checklist);
  const fileName = `${checklist.task.taskCode}-quality-checklist`.replace(/[^a-zA-Z0-9-_]/g, '_');

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
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: `${checklist.task.taskCode} — Quality Checklist`,
    UTI: 'com.adobe.pdf',
  });
  return '';
}
