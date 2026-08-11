import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { parseTemplateSheetBytes, type TemplateSheetParseResult } from './templateSheetParser';

export interface PickedTemplateSheet {
  fileName: string;
  parsed: TemplateSheetParseResult;
}

const EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
];

// The picker + byte-read is the one genuinely platform-specific part of
// this feature — everything else (parseTemplateSheetBytes, the preview,
// the commit) is plain data. Web hands back a real File/Blob directly
// (DocumentPickerAsset.file); native only ever gives a cache-directory URI,
// read via expo-file-system's File.arrayBuffer(). Returns null if the user
// cancels the picker (not an error).
export async function pickAndParseTemplateSheet(): Promise<PickedTemplateSheet | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: EXCEL_MIME_TYPES,
    copyToCacheDirectory: true,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];

  const buffer = asset.file ? await asset.file.arrayBuffer() : await new File(asset.uri).arrayBuffer();
  const parsed = parseTemplateSheetBytes(new Uint8Array(buffer));

  return { fileName: asset.name, parsed };
}
