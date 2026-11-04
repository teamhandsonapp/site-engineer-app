import { type ReactNode } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// In-app mock document viewer for the Files screen's dummy data — renders a
// realistic-looking drawing sheet / transmittal / RA bill / spreadsheet /
// quotation right on screen instead of opening a real file, so it works the
// same on web and on a phone with nothing to download. Presentation-only.

export interface DrawingBox {
  label: string;
  x: number; // all in % of the plan area
  y: number;
  w: number;
  h: number;
  fill?: string;
}

export interface TransmittalItem {
  drawingNo: string;
  title: string;
  rev: string;
  releaseDate: string;
  copies: number;
}

export type FilePreviewSpec =
  | { type: 'drawing'; sheetNo: string; scale: string; drawnBy: string; boxes: DrawingBox[]; points?: { x: number; y: number; label: string }[]; notes: string[] }
  | { type: 'transmittal'; ref: string; to: string; from: string; purpose: string; items: TransmittalItem[]; status: string }
  | { type: 'bill'; billNo: string; period: string; contractor: string; items: { desc: string; unit: string; qty: number; rate: number }[]; previousCertified: number; status: string }
  | { type: 'sheet'; sheetName: string; columns: string[]; rows: (string | number)[][] }
  | { type: 'comparative'; title: string; vendors: string[]; rows: { item: string; unit: string; qty: number; rates: number[] }[] }
  | { type: 'quote'; vendor: string; quoteNo: string; items: { desc: string; unit: string; qty: number; rate: number }[]; approvedBy: string; approvedOn: string }
  // A file the user just picked via Upload Document — held in memory only.
  | { type: 'uploaded'; uri: string; mimeType: string | null; folderName: string };

// Indian digit grouping (12,34,567) without relying on Intl being present.
export function inr(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [whole, dec = ''] = Number.isInteger(rounded) ? [String(rounded)] : rounded.toFixed(2).split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹ ${rest ? `${rest},${last3}` : last3}${dec ? `.${dec}` : ''}`;
}

const NAVY = '#0F1F33';

function Paper({ children }: { children: ReactNode }) {
  return (
    <View
      className="bg-white rounded-md p-4"
      style={{ shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}
    >
      {children}
    </View>
  );
}

function Row({ cells, widths, bold, bg, color }: { cells: (string | number)[]; widths: number[]; bold?: boolean; bg?: string; color?: string }) {
  return (
    <View className="flex-row border-b border-neutral-200" style={{ backgroundColor: bg }}>
      {cells.map((c, i) => (
        <Text
          key={i}
          className={`text-2xs px-1.5 py-1.5 ${bold ? 'font-bold' : ''}`}
          style={{ flex: widths[i], color: color ?? '#262626', textAlign: typeof c === 'number' || i > 0 ? 'right' : 'left' }}
        >
          {c}
        </Text>
      ))}
    </View>
  );
}

function Stamp({ text, color }: { text: string; color: string }) {
  return (
    <View className="self-end mt-3 px-3 py-1.5 rounded border-2" style={{ borderColor: color, transform: [{ rotate: '-6deg' }] }}>
      <Text className="text-xs font-bold tracking-widest" style={{ color }}>
        {text}
      </Text>
    </View>
  );
}

function DocHeader({ title, projectName, right }: { title: string; projectName: string; right?: string }) {
  return (
    <View className="border-b-2 pb-2 mb-3" style={{ borderColor: NAVY }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-2xs font-bold tracking-widest" style={{ color: NAVY }}>
          PMC PORTAL
        </Text>
        {right && <Text className="text-2xs text-neutral-500">{right}</Text>}
      </View>
      <Text className="text-base font-bold text-neutral-900 mt-1">{title}</Text>
      <Text className="text-2xs text-neutral-500">Project: {projectName}</Text>
    </View>
  );
}

function DrawingPreview({ spec, projectName, title }: { spec: Extract<FilePreviewSpec, { type: 'drawing' }>; projectName: string; title: string }) {
  return (
    <Paper>
      <View className="border-2 p-2" style={{ borderColor: NAVY }}>
        {/* Plan area */}
        <View style={{ aspectRatio: 1.3, backgroundColor: '#F8FAFC' }}>
          {/* grid */}
          {Array.from({ length: 9 }).map((_, i) => (
            <View key={`v${i}`} style={{ position: 'absolute', left: `${(i + 1) * 10}%`, top: 0, bottom: 0, width: 1, backgroundColor: '#E2E8F0' }} />
          ))}
          {Array.from({ length: 9 }).map((_, i) => (
            <View key={`h${i}`} style={{ position: 'absolute', top: `${(i + 1) * 10}%`, left: 0, right: 0, height: 1, backgroundColor: '#E2E8F0' }} />
          ))}
          {spec.boxes.map((b) => (
            <View
              key={b.label + b.x + b.y}
              style={{
                position: 'absolute',
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: `${b.w}%`,
                height: `${b.h}%`,
                borderWidth: 2,
                borderColor: '#1E3A8A',
                backgroundColor: b.fill ?? 'rgba(191,219,254,0.25)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: '700', color: '#1E3A8A', textAlign: 'center' }}>{b.label}</Text>
            </View>
          ))}
          {spec.points?.map((p, i) => (
            <View key={i} style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, alignItems: 'center' }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC2626', borderWidth: 1.5, borderColor: '#fff' }} />
              <Text style={{ fontSize: 7, fontWeight: '700', color: '#DC2626' }}>{p.label}</Text>
            </View>
          ))}
          {/* north arrow */}
          <View style={{ position: 'absolute', right: 6, top: 6, alignItems: 'center' }}>
            <Ionicons name="navigate" size={14} color={NAVY} style={{ transform: [{ rotate: '-45deg' }] }} />
            <Text style={{ fontSize: 8, fontWeight: '700', color: NAVY }}>N</Text>
          </View>
        </View>

        {/* Notes */}
        <View className="mt-2 border-t border-neutral-300 pt-1.5">
          <Text className="text-2xs font-bold text-neutral-800 mb-0.5">NOTES</Text>
          {spec.notes.map((n, i) => (
            <Text key={i} className="text-2xs text-neutral-600">
              {i + 1}. {n}
            </Text>
          ))}
        </View>

        {/* Title block */}
        <View className="mt-2 flex-row border" style={{ borderColor: NAVY }}>
          <View className="flex-1 p-1.5 border-r" style={{ borderColor: NAVY }}>
            <Text style={{ fontSize: 8 }} className="text-neutral-500">PROJECT</Text>
            <Text className="text-2xs font-bold text-neutral-900" numberOfLines={1}>{projectName}</Text>
            <Text style={{ fontSize: 8 }} className="text-neutral-500 mt-1">DRAWING</Text>
            <Text className="text-2xs font-bold text-neutral-900" numberOfLines={2}>{title}</Text>
          </View>
          <View className="p-1.5" style={{ width: 96 }}>
            <Text style={{ fontSize: 8 }} className="text-neutral-500">SHEET</Text>
            <Text className="text-2xs font-bold text-neutral-900">{spec.sheetNo}</Text>
            <Text style={{ fontSize: 8 }} className="text-neutral-500 mt-1">SCALE</Text>
            <Text className="text-2xs font-bold text-neutral-900">{spec.scale}</Text>
            <Text style={{ fontSize: 8 }} className="text-neutral-500 mt-1">BY</Text>
            <Text className="text-2xs font-bold text-neutral-900">{spec.drawnBy}</Text>
          </View>
        </View>
      </View>
    </Paper>
  );
}

function TransmittalPreview({ spec, projectName }: { spec: Extract<FilePreviewSpec, { type: 'transmittal' }>; projectName: string }) {
  return (
    <Paper>
      <DocHeader title="Document Transmittal" projectName={projectName} right={spec.ref} />
      {[
        ['To', spec.to],
        ['From', spec.from],
        ['Purpose', spec.purpose],
      ].map(([k, v]) => (
        <View key={k} className="flex-row mb-1">
          <Text className="text-2xs font-bold text-neutral-700" style={{ width: 64 }}>{k}</Text>
          <Text className="text-2xs text-neutral-800 flex-1">{v}</Text>
        </View>
      ))}
      <View className="mt-3 border border-neutral-200 rounded">
        <Row cells={['Drawing No', 'Title', 'Rev', 'Released', 'Copies']} widths={[1.3, 2.6, 0.7, 1.5, 0.9]} bold bg="#F1F5F9" />
        {spec.items.map((it, i) => (
          <Row key={i} cells={[it.drawingNo, it.title, it.rev, it.releaseDate, it.copies]} widths={[1.3, 2.6, 0.7, 1.5, 0.9]} />
        ))}
      </View>
      <View className="flex-row justify-between mt-6">
        <View>
          <View className="border-b border-neutral-400" style={{ width: 110 }} />
          <Text className="text-2xs text-neutral-500 mt-1">Issued by (PMC)</Text>
        </View>
        <View>
          <View className="border-b border-neutral-400" style={{ width: 110 }} />
          <Text className="text-2xs text-neutral-500 mt-1">Received by</Text>
        </View>
      </View>
      <Stamp text={spec.status.toUpperCase()} color={spec.status.startsWith('Pending') ? '#D97706' : '#059669'} />
    </Paper>
  );
}

function BillPreview({ spec, projectName }: { spec: Extract<FilePreviewSpec, { type: 'bill' }>; projectName: string }) {
  const gross = spec.items.reduce((s, it) => s + it.qty * it.rate, 0);
  const thisBill = gross - spec.previousCertified;
  const retention = thisBill * 0.05;
  const tds = thisBill * 0.02;
  const net = thisBill - retention - tds;
  const w = [3.2, 0.9, 1, 1.2, 1.6];
  return (
    <Paper>
      <DocHeader title={`Running Account Bill — ${spec.billNo}`} projectName={projectName} right={spec.period} />
      <Text className="text-2xs text-neutral-700 mb-2">
        Contractor: <Text className="font-bold">{spec.contractor}</Text>
      </Text>
      <View className="border border-neutral-200 rounded">
        <Row cells={['Description', 'Unit', 'Qty', 'Rate', 'Amount']} widths={w} bold bg="#F1F5F9" />
        {spec.items.map((it, i) => (
          <Row key={i} cells={[it.desc, it.unit, it.qty, inr(it.rate), inr(it.qty * it.rate)]} widths={w} />
        ))}
        <Row cells={['Gross value of work done to date', '', '', '', inr(gross)]} widths={w} bold />
        <Row cells={['Less: previously certified', '', '', '', `− ${inr(spec.previousCertified)}`]} widths={w} />
        <Row cells={['Value of this bill', '', '', '', inr(thisBill)]} widths={w} bold />
        <Row cells={['Less: retention @ 5%', '', '', '', `− ${inr(retention)}`]} widths={w} />
        <Row cells={['Less: TDS @ 2%', '', '', '', `− ${inr(tds)}`]} widths={w} />
        <Row cells={['NET PAYABLE', '', '', '', inr(net)]} widths={w} bold bg="#ECFDF5" color="#065F46" />
      </View>
      <Stamp text={spec.status.toUpperCase()} color={spec.status === 'Paid' ? '#059669' : spec.status === 'Certified' ? '#2563EB' : '#D97706'} />
    </Paper>
  );
}

const COL_LETTERS = 'ABCDEFGHIJ';

function SheetFrame({ sheetName, children, colCount }: { sheetName: string; children: ReactNode; colCount: number }) {
  return (
    <View className="bg-white rounded-md overflow-hidden border border-neutral-300">
      <View className="flex-row items-center gap-1.5 px-2 py-1.5" style={{ backgroundColor: '#107C41' }}>
        <Ionicons name="grid" size={12} color="#fff" />
        <Text className="text-2xs font-bold text-white">Spreadsheet view</Text>
      </View>
      <ScrollView horizontal>
        <View>
          <View className="flex-row" style={{ backgroundColor: '#F3F4F6' }}>
            <Text style={{ width: 28 }} />
            {Array.from({ length: colCount }).map((_, i) => (
              <Text key={i} className="text-2xs text-neutral-500 text-center border-l border-neutral-300 py-0.5" style={{ width: i === 0 ? 170 : 96 }}>
                {COL_LETTERS[i]}
              </Text>
            ))}
          </View>
          {children}
        </View>
      </ScrollView>
      <View className="flex-row border-t border-neutral-300" style={{ backgroundColor: '#F3F4F6' }}>
        <Text className="text-2xs font-bold px-3 py-1 bg-white border-r border-neutral-300" style={{ color: '#107C41' }}>
          {sheetName}
        </Text>
      </View>
    </View>
  );
}

function Cell({ v, i, bold, bg, color }: { v: string | number; i: number; bold?: boolean; bg?: string; color?: string }) {
  return (
    <Text
      className={`text-2xs px-1.5 py-1 border-l border-b border-neutral-200 ${bold ? 'font-bold' : ''}`}
      style={{ width: i === 0 ? 170 : 96, textAlign: i === 0 ? 'left' : 'right', backgroundColor: bg, color: color ?? '#262626' }}
      numberOfLines={1}
    >
      {v}
    </Text>
  );
}

function RowNum({ n }: { n: number }) {
  return (
    <Text className="text-2xs text-neutral-500 text-center py-1 border-b border-neutral-200" style={{ width: 28, backgroundColor: '#F3F4F6' }}>
      {n}
    </Text>
  );
}

function SheetPreview({ spec }: { spec: Extract<FilePreviewSpec, { type: 'sheet' }> }) {
  return (
    <SheetFrame sheetName={spec.sheetName} colCount={spec.columns.length}>
      <View className="flex-row">
        <RowNum n={1} />
        {spec.columns.map((c, i) => (
          <Cell key={i} v={c} i={i} bold bg="#E8F5E9" />
        ))}
      </View>
      {spec.rows.map((r, ri) => (
        <View key={ri} className="flex-row">
          <RowNum n={ri + 2} />
          {r.map((v, i) => (
            <Cell key={i} v={typeof v === 'number' ? v.toFixed(2) : v} i={i} />
          ))}
        </View>
      ))}
    </SheetFrame>
  );
}

function ComparativePreview({ spec }: { spec: Extract<FilePreviewSpec, { type: 'comparative' }> }) {
  const totals = spec.vendors.map((_, vi) => spec.rows.reduce((s, r) => s + r.qty * r.rates[vi], 0));
  const best = totals.indexOf(Math.min(...totals));
  const cols = ['Item', 'Unit', 'Qty', ...spec.vendors];
  return (
    <SheetFrame sheetName="Comparison" colCount={cols.length}>
      <View className="flex-row">
        <RowNum n={1} />
        <Cell v={spec.title} i={0} bold />
        {cols.slice(1).map((_, i) => (
          <Cell key={i} v="" i={i + 1} />
        ))}
      </View>
      <View className="flex-row">
        <RowNum n={2} />
        {cols.map((c, i) => (
          <Cell key={i} v={c} i={i} bold bg={i - 3 === best ? '#BBF7D0' : '#E8F5E9'} />
        ))}
      </View>
      {spec.rows.map((r, ri) => {
        const low = Math.min(...r.rates);
        return (
          <View key={ri} className="flex-row">
            <RowNum n={ri + 3} />
            <Cell v={r.item} i={0} />
            <Cell v={r.unit} i={1} />
            <Cell v={r.qty} i={2} />
            {r.rates.map((rate, vi) => (
              <Cell key={vi} v={inr(rate)} i={vi + 3} bg={rate === low ? '#DCFCE7' : undefined} color={rate === low ? '#166534' : undefined} />
            ))}
          </View>
        );
      })}
      <View className="flex-row">
        <RowNum n={spec.rows.length + 3} />
        <Cell v="TOTAL" i={0} bold />
        <Cell v="" i={1} />
        <Cell v="" i={2} />
        {totals.map((t, vi) => (
          <Cell key={vi} v={inr(t)} i={vi + 3} bold bg={vi === best ? '#BBF7D0' : '#F9FAFB'} color={vi === best ? '#166534' : undefined} />
        ))}
      </View>
      <View className="flex-row">
        <RowNum n={spec.rows.length + 4} />
        <Cell v={`Recommended: ${spec.vendors[best]} (L1)`} i={0} bold color="#166534" />
        {cols.slice(1).map((_, i) => (
          <Cell key={i} v="" i={i + 1} />
        ))}
      </View>
    </SheetFrame>
  );
}

function QuotePreview({ spec, projectName }: { spec: Extract<FilePreviewSpec, { type: 'quote' }>; projectName: string }) {
  const sub = spec.items.reduce((s, it) => s + it.qty * it.rate, 0);
  const gst = sub * 0.18;
  const w = [3.2, 0.9, 1, 1.2, 1.6];
  return (
    <Paper>
      <DocHeader title={`Quotation — ${spec.vendor}`} projectName={projectName} right={spec.quoteNo} />
      <View className="border border-neutral-200 rounded">
        <Row cells={['Description', 'Unit', 'Qty', 'Rate', 'Amount']} widths={w} bold bg="#F1F5F9" />
        {spec.items.map((it, i) => (
          <Row key={i} cells={[it.desc, it.unit, it.qty, inr(it.rate), inr(it.qty * it.rate)]} widths={w} />
        ))}
        <Row cells={['Sub-total', '', '', '', inr(sub)]} widths={w} bold />
        <Row cells={['GST @ 18%', '', '', '', inr(gst)]} widths={w} />
        <Row cells={['GRAND TOTAL', '', '', '', inr(sub + gst)]} widths={w} bold bg="#ECFDF5" color="#065F46" />
      </View>
      <Text className="text-2xs text-neutral-500 mt-3">Terms: 50% advance, balance on delivery. Delivery within 15 days of PO. Prices valid for 30 days.</Text>
      <Text className="text-2xs text-neutral-700 mt-2">
        Approved by <Text className="font-bold">{spec.approvedBy}</Text> on {spec.approvedOn}
      </Text>
      <Stamp text="APPROVED" color="#059669" />
    </Paper>
  );
}

function UploadedPreview({ spec, name, meta }: { spec: Extract<FilePreviewSpec, { type: 'uploaded' }>; name: string; meta: string }) {
  const isImage = spec.mimeType?.startsWith('image/') ?? false;
  if (isImage) {
    return (
      <Paper>
        <Image source={{ uri: spec.uri }} style={{ width: '100%', aspectRatio: 0.75, borderRadius: 4 }} resizeMode="contain" />
      </Paper>
    );
  }
  return (
    <Paper>
      <View className="items-center py-6">
        <View className="h-16 w-16 items-center justify-center rounded-2xl mb-3" style={{ backgroundColor: '#EEF2FF' }}>
          <Ionicons name="document-attach" size={32} color="#4338CA" />
        </View>
        <Text className="text-sm font-bold text-neutral-900 text-center">{name}</Text>
        <Text className="text-2xs text-neutral-500 mt-1 text-center">{meta}</Text>
        <View className="flex-row items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full" style={{ backgroundColor: '#DCFCE7' }}>
          <Ionicons name="checkmark-circle" size={14} color="#15803D" />
          <Text className="text-2xs font-bold" style={{ color: '#15803D' }}>
            Uploaded to {spec.folderName}
          </Text>
        </View>
        {Platform.OS === 'web' && (
          <Pressable onPress={() => void Linking.openURL(spec.uri)} className="flex-row items-center gap-1.5 mt-4 px-4 py-2 rounded-lg" style={{ backgroundColor: NAVY }}>
            <Ionicons name="open-outline" size={14} color="#fff" />
            <Text className="text-xs font-bold text-white">Open file</Text>
          </Pressable>
        )}
      </View>
    </Paper>
  );
}

export function FilePreview({
  name,
  meta,
  spec,
  projectName,
  onClose,
}: {
  name: string;
  meta: string;
  spec: FilePreviewSpec;
  projectName: string;
  onClose: () => void;
}) {
  return (
    <View className="flex-1" style={{ backgroundColor: '#525659' }}>
      {/* Viewer toolbar */}
      <View className="flex-row items-center gap-3 px-3 py-2.5" style={{ backgroundColor: '#323639' }}>
        <Pressable onPress={onClose} hitSlop={10} className="flex-row items-center gap-1">
          <Ionicons name="arrow-back" size={18} color="#fff" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-sm font-bold text-white" numberOfLines={1}>
            {name}
          </Text>
          <Text className="text-2xs" style={{ color: 'rgba(255,255,255,0.6)' }} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <Text className="text-2xs font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
          Page 1 / 1
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {spec.type === 'drawing' && <DrawingPreview spec={spec} projectName={projectName} title={name.replace(/\.\w+$/, '')} />}
        {spec.type === 'transmittal' && <TransmittalPreview spec={spec} projectName={projectName} />}
        {spec.type === 'bill' && <BillPreview spec={spec} projectName={projectName} />}
        {spec.type === 'sheet' && <SheetPreview spec={spec} />}
        {spec.type === 'comparative' && <ComparativePreview spec={spec} />}
        {spec.type === 'quote' && <QuotePreview spec={spec} projectName={projectName} />}
        {spec.type === 'uploaded' && <UploadedPreview spec={spec} name={name} meta={meta} />}
      </ScrollView>
    </View>
  );
}
