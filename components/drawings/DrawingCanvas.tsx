import { Text, View } from 'react-native';
import type { TagDTO } from '../../lib/drawings/types';

// Native build: the PDF renderer for phones is decided in Step 1 of the
// drawings plan (docs/mobile-drawings-parity.md §4.1) and needs a new app
// build. Until then the native app shows this notice; the web build
// (DrawingCanvas.web.tsx) renders drawings with pdf.js like admin-web.
// The prop types mirror DrawingCanvas.web.tsx exactly.

export interface PdfRef {
  versionId: string;
  url: string;
}
export interface OverlayLayer extends PdfRef {
  key: string;
  color: string;
}
export interface CompareInfo {
  olderVersionId: string;
  newerVersionId: string;
  regions: number;
  sameSize: boolean;
}
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function DrawingCanvas(_props: {
  base: PdfRef | null;
  showBase: boolean;
  compareWith: PdfRef | null;
  overlays: OverlayLayer[];
  page: number;
  tags: TagDTO[];
  selectedTagId: string | null;
  onSelectTag: (id: string | null) => void;
  tagMode: boolean;
  onBoxDrawn: (box: Box) => void;
  onCompareInfo: (info: CompareInfo) => void;
  draftBox: Box | null;
}) {
  return (
    <View className="flex-1 items-center justify-center bg-neutral-100 px-8">
      <Text className="text-sm font-semibold text-neutral-700 text-center">Drawing preview comes with the next app update</Text>
      <Text className="text-xs text-neutral-500 text-center mt-1">Tags, layers and revisions are listed below.</Text>
    </View>
  );
}
