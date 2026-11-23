import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Text, TextInput } from '../ui/AppText';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { Button } from '../ui/Button';
import { BottomSheet, Chip, ConsultantStatusBadge, FieldLabel, formatBytes, formatDate, formatDateTime } from './ui';
import {
  DISCIPLINES,
  DISCIPLINE_COLOR,
  DISCIPLINE_LABEL,
  revLabel,
  type DrawingDiscipline,
  type DrawingViewerDTO,
  type OverlayDTO,
} from '../../lib/drawings/types';
import { createDrawing, MAX_DRAWING_PDF_MB, uploadDrawingRevision } from '../../lib/drawings/data';

const inputClass = 'border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 bg-white';

/* ── Layers (admin-web side panel "Layers") ───────────────────────── */

export function LayersSheet({
  data,
  isOn,
  toggle,
  showAll,
  hideOthers,
  staleNoteFor,
  canEdit,
  onClose,
}: {
  data: DrawingViewerDTO;
  isOn: (key: string) => boolean;
  toggle: (key: string) => void;
  showAll: () => void;
  hideOthers: () => void;
  staleNoteFor: (o: OverlayDTO) => string | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { drawing, versions, overlays, project } = data;
  const current = versions[0] ?? null;
  return (
    <BottomSheet title="Layers" onClose={onClose}>
      <View className="flex-row gap-2 mb-2">
        <Button label="Show all" size="sm" variant="ghost" onPress={showAll} />
        <Button label="Hide others" size="sm" variant="ghost" onPress={hideOthers} />
      </View>
      <LayerRow
        color={DISCIPLINE_COLOR[drawing.discipline]}
        label={`${drawing.sheetNumber} · ${DISCIPLINE_LABEL[drawing.discipline]}`}
        sub={current ? `${revLabel(current.revisionNumber)} · ${formatDate(current.uploadedAt)}` : 'No PDF yet'}
        checked={isOn('__base')}
        onToggle={() => toggle('__base')}
      />
      {overlays.map((o) => {
        const ov = o.versions[0];
        const stale = staleNoteFor(o);
        return (
          <View key={o.id}>
            <LayerRow
              color={DISCIPLINE_COLOR[o.discipline]}
              label={`${o.sheetNumber} · ${DISCIPLINE_LABEL[o.discipline]}`}
              sub={ov ? `${revLabel(ov.revisionNumber)}${ov.basedOnRevision !== null ? ` · on ${drawing.sheetNumber} ${revLabel(ov.basedOnRevision)}` : ''}` : 'Not issued yet'}
              checked={isOn(o.id)}
              disabled={!ov}
              onToggle={() => toggle(o.id)}
            />
            {stale && isOn(o.id) ? <Text className="ml-9 mb-1 text-xs text-red-700 bg-red-50 rounded-md px-2 py-1.5">{stale}</Text> : null}
          </View>
        );
      })}
      {!drawing.base && canEdit ? (
        <Pressable
          onPress={() => {
            onClose();
            router.push({ pathname: '/drawings', params: { projectId: project.id, newFor: drawing.id } } as never);
          }}
          className="mt-2 py-2.5"
        >
          <Text className="text-sm font-semibold text-brand-navy">+ Add department drawing</Text>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}

function LayerRow({ color, label, sub, checked, disabled, onToggle }: { color: string; label: string; sub: string; checked: boolean; disabled?: boolean; onToggle: () => void }) {
  const on = checked && !disabled;
  return (
    <Pressable onPress={onToggle} disabled={disabled} className={`flex-row items-center py-2 ${disabled ? 'opacity-50' : ''}`} style={{ minHeight: 48 }}>
      <View className={`w-5 h-5 rounded border-2 items-center justify-center mr-2.5 ${on ? 'bg-brand-navy border-brand-navy' : 'border-neutral-300 bg-white'}`}>
        {on ? <Text className="text-white text-2xs font-bold">✓</Text> : null}
      </View>
      <View className="w-5 h-1 rounded-full mr-2.5" style={{ backgroundColor: color }} />
      <View className="flex-1">
        <Text className="text-sm text-neutral-900">{label}</Text>
        <Text className="text-xs text-neutral-500" numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

/* ── Revisions (admin-web side panel "Revisions") ─────────────────── */

export function RevisionsSheet({
  data,
  currentId,
  onPick,
  onUpload,
  onRemind,
  reminding,
  canEdit,
  onClose,
}: {
  data: DrawingViewerDTO;
  currentId: string | null;
  onPick: (versionId: string) => void;
  onUpload: (o?: OverlayDTO) => void;
  onRemind: (o: OverlayDTO) => void;
  reminding: string | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { drawing, versions, overlays, project } = data;
  const latest = versions[0] ?? null;
  const overdue = overlays.filter((o) => o.status.overdueDays > 0);
  return (
    <BottomSheet title="Revisions" onClose={onClose}>
      {data.selfStatus && data.selfStatus.state !== 'current' && drawing.base ? (
        <View className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <Text className="text-sm text-red-800 mb-1">This sheet is behind the latest revision of {drawing.base.sheetNumber}.</Text>
          <ConsultantStatusBadge status={data.selfStatus} />
        </View>
      ) : null}
      {overdue.length > 0 ? (
        <View className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5">
          <Text className="text-sm font-semibold text-red-700">{overdue.length === 1 ? 'Consultant drawing overdue' : `${overdue.length} consultant drawings overdue`}</Text>
          <Text className="text-xs text-red-800 mt-0.5">
            {overdue.map((o) => `${o.sheetNumber} (${o.status.overdueDays}d)`).join(', ')} not yet updated for {drawing.sheetNumber} {latest && revLabel(latest.revisionNumber)}.
          </Text>
        </View>
      ) : null}
      {overlays.map((o) => (
        <View key={o.id} className="rounded-lg border border-neutral-100 p-2.5 mb-2.5">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => {
                onClose();
                router.push({ pathname: '/drawings/[drawingId]', params: { drawingId: o.id, projectId: project.id } } as never);
              }}
              className="flex-row items-center"
            >
              <View className="w-2 h-2 rounded-sm mr-1.5" style={{ backgroundColor: DISCIPLINE_COLOR[o.discipline] }} />
              <Text className="text-sm font-semibold text-neutral-900 underline">{o.sheetNumber}</Text>
            </Pressable>
            <ConsultantStatusBadge status={o.status} />
          </View>
          <Text className="text-xs text-neutral-500 mt-1">
            {o.consultantName ?? 'Consultant'}
            {o.lastReminderAt ? ` · reminded ${formatDateTime(o.lastReminderAt)}` : ''}
          </Text>
          {canEdit ? (
            <View className="flex-row flex-wrap gap-1.5 mt-2">
              <Button label={`Upload ${o.sheetNumber} ${revLabel(o.versions[0] ? o.versions[0].revisionNumber + 1 : 0)}`} size="sm" variant="secondary" onPress={() => onUpload(o)} />
              {o.status.state !== 'current' && o.status.state !== 'no_base' ? (
                <Button label={reminding === o.id ? 'Sending…' : 'Send reminder'} size="sm" variant="secondary" disabled={!o.consultantEmail || reminding === o.id} onPress={() => onRemind(o)} />
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
      {versions.length === 0 ? <Text className="text-sm text-neutral-500">No revisions uploaded yet.</Text> : null}
      {versions.map((v) => (
        <View key={v.id} className="flex-row mb-3">
          <View className={`w-8 h-8 rounded-full items-center justify-center mr-2.5 ${v.id === currentId ? 'bg-neutral-900' : 'bg-neutral-100'}`}>
            <Text className={`text-2xs font-bold ${v.id === currentId ? 'text-white' : 'text-neutral-700'}`}>{revLabel(v.revisionNumber)}</Text>
          </View>
          <View className="flex-1">
            <Pressable onPress={() => onPick(v.id)}>
              <Text className="text-sm font-semibold text-neutral-900 underline">
                {drawing.sheetNumber} {revLabel(v.revisionNumber)} · {formatDate(v.uploadedAt)}
              </Text>
            </Pressable>
            <Text className="text-xs text-neutral-500" numberOfLines={1}>
              {v.uploadedByName ?? 'Unknown'}
              {v.basedOnRevision !== null && drawing.base ? ` · on ${drawing.base.sheetNumber} ${revLabel(v.basedOnRevision)}` : ''}
              {v.url ? ' · ' : ''}
              {v.url ? (
                <Text className="underline" onPress={() => Linking.openURL(v.url!)}>
                  PDF
                </Text>
              ) : null}
            </Text>
            {v.changeNote ? <Text className="text-xs text-neutral-700 mt-0.5">{v.changeNote}</Text> : null}
          </View>
        </View>
      ))}
    </BottomSheet>
  );
}

/* ── Upload revision (admin-web UploadRevisionDialog) ─────────────── */

export interface UploadRevisionTarget {
  drawingId: string;
  sheetNumber: string;
  title: string;
  nextRevision: number;
  base?: { sheetNumber: string; versions: { id: string; revisionNumber: number }[] };
}

export function UploadRevisionSheet({
  target,
  projectId,
  userId,
  onClose,
  onUploaded,
}: {
  target: UploadRevisionTarget;
  projectId: string;
  userId: string;
  onClose: () => void;
  onUploaded: (revisionNumber: number) => void;
}) {
  const [file, setFile] = useState<{ uri: string; name: string; size: number | null } | null>(null);
  const [basedOn, setBasedOn] = useState<string>(target.base?.versions[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setFile({ uri: a.uri, name: a.name, size: a.size ?? null });
  }

  async function submit() {
    if (!file) return setError('Choose a PDF file');
    if (!/\.pdf$/i.test(file.name)) return setError('Only PDF drawings are supported for now');
    if (file.size && file.size > MAX_DRAWING_PDF_MB * 1024 * 1024) return setError(`PDF is larger than ${MAX_DRAWING_PDF_MB} MB`);
    setError(null);
    setBusy(true);
    try {
      const n = await uploadDrawingRevision({ projectId, drawingId: target.drawingId, uri: file.uri, fileName: file.name, changeNote: note, basedOnVersionId: basedOn || null, uploadedById: userId });
      onUploaded(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      title={`Upload ${target.sheetNumber} ${revLabel(target.nextRevision)}`}
      subtitle={target.title}
      onClose={() => !busy && onClose()}
      footer={
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
          </View>
          <View className="flex-1">
            <Button label={busy ? `Uploading${file?.size ? ` ${formatBytes(file.size)}` : ''}…` : 'Upload'} onPress={submit} disabled={busy} />
          </View>
        </View>
      }
    >
      {error ? <Text className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">{error}</Text> : null}
      <FieldLabel>Drawing PDF</FieldLabel>
      <Pressable onPress={pick} className="border border-dashed border-neutral-300 rounded-lg px-3 py-3" style={{ minHeight: 48 }}>
        <Text className="text-sm text-neutral-700">{file ? `${file.name}${file.size ? ` · ${formatBytes(file.size)}` : ''}` : 'Choose a PDF…'}</Text>
      </Pressable>
      {target.base ? (
        <View className="mt-4">
          <FieldLabel>Drawn against {target.base.sheetNumber}</FieldLabel>
          {target.base.versions.length === 0 ? (
            <Text className="text-sm text-neutral-500">The base sheet has no revisions uploaded yet.</Text>
          ) : (
            <View className="flex-row flex-wrap">
              {target.base.versions.map((v, i) => (
                <Chip key={v.id} label={`${target.base!.sheetNumber} ${revLabel(v.revisionNumber)}${i === 0 ? ' (latest)' : ''}`} active={basedOn === v.id} onPress={() => setBasedOn(v.id)} />
              ))}
            </View>
          )}
        </View>
      ) : null}
      <View className="mt-4">
        <FieldLabel>What changed? (optional)</FieldLabel>
        <TextInput value={note} onChangeText={setNote} placeholder={target.nextRevision === 0 ? 'First issue' : 'e.g. Window W3 widened, new window W6'} className={inputClass} multiline />
      </View>
    </BottomSheet>
  );
}

/* ── New floor plan / department drawing (admin-web NewDrawingForm) ─ */

export function NewDrawingSheet({
  projectId,
  userId,
  defaultBaseId,
  baseOptions,
  onClose,
  onCreated,
}: {
  projectId: string;
  userId: string;
  defaultBaseId: string;
  baseOptions: { id: string; sheetNumber: string; title: string }[];
  onClose: () => void;
  onCreated: (drawingId: string) => void;
}) {
  const [sheetNumber, setSheetNumber] = useState('');
  const [title, setTitle] = useState('');
  const [discipline, setDiscipline] = useState<DrawingDiscipline>(defaultBaseId ? 'ELECTRICAL' : 'ARCHITECTURAL');
  const [baseId, setBaseId] = useState(defaultBaseId);
  const [consultantName, setConsultantName] = useState('');
  const [consultantEmail, setConsultantEmail] = useState('');
  const [responseDays, setResponseDays] = useState('3');
  const [file, setFile] = useState<{ uri: string; name: string; size: number | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isConsultant = !!baseId;

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setFile({ uri: a.uri, name: a.name, size: a.size ?? null });
  }

  async function submit() {
    if (file && !/\.pdf$/i.test(file.name)) return setError('Only PDF drawings are supported for now');
    if (file?.size && file.size > MAX_DRAWING_PDF_MB * 1024 * 1024) return setError(`PDF is larger than ${MAX_DRAWING_PDF_MB} MB`);
    setError(null);
    setBusy('Creating sheet…');
    let id: string;
    try {
      id = await createDrawing({ projectId, sheetNumber, title, discipline, baseDrawingId: baseId || null, consultantName, consultantEmail, responseDays: Number(responseDays), createdById: userId });
    } catch (e) {
      setBusy(null);
      return setError(e instanceof Error ? e.message : String(e));
    }
    if (file) {
      setBusy(`Uploading${file.size ? ` ${formatBytes(file.size)}` : ''}…`);
      try {
        await uploadDrawingRevision({ projectId, drawingId: id, uri: file.uri, fileName: file.name, changeNote: '', basedOnVersionId: null, uploadedById: userId });
      } catch (e) {
        setBusy(null);
        setError(`Sheet created, but the PDF upload failed: ${e instanceof Error ? e.message : String(e)}. You can upload it again from the sheet.`);
        return;
      }
    }
    onCreated(id);
  }

  return (
    <BottomSheet
      title={defaultBaseId ? 'New department drawing' : 'New floor plan'}
      onClose={() => !busy && onClose()}
      footer={
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button label="Cancel" variant="secondary" onPress={onClose} disabled={!!busy} />
          </View>
          <View className="flex-1">
            <Button label={busy ?? 'Create sheet'} onPress={submit} disabled={!!busy || !sheetNumber.trim() || !title.trim()} />
          </View>
        </View>
      }
    >
      {error ? <Text className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">{error}</Text> : null}
      <FieldLabel>Sheet number</FieldLabel>
      <TextInput value={sheetNumber} onChangeText={setSheetNumber} placeholder={isConsultant ? 'e.g. E-101' : 'e.g. A-101'} maxLength={40} className={inputClass} autoCapitalize="characters" />
      <View className="mt-3">
        <FieldLabel>Title</FieldLabel>
        <TextInput value={title} onChangeText={setTitle} placeholder={isConsultant ? 'e.g. Electrical Layout' : 'e.g. Ground Floor Plan'} maxLength={200} className={inputClass} />
      </View>
      <View className="mt-3">
        <FieldLabel>Department</FieldLabel>
        <View className="flex-row flex-wrap">
          {DISCIPLINES.map((d) => (
            <Chip key={d} label={DISCIPLINE_LABEL[d]} color={DISCIPLINE_COLOR[d]} active={discipline === d} onPress={() => setDiscipline(d)} />
          ))}
        </View>
      </View>
      <View className="mt-3">
        <FieldLabel>Floor plan</FieldLabel>
        <View className="flex-row flex-wrap">
          <Chip label="None — not on a floor plan" active={!baseId} onPress={() => setBaseId('')} />
          {baseOptions.map((b) => (
            <Chip key={b.id} label={`${b.sheetNumber} · ${b.title}`} active={baseId === b.id} onPress={() => setBaseId(b.id)} />
          ))}
        </View>
      </View>
      <View className="mt-3">
        <FieldLabel>Consultant</FieldLabel>
        <TextInput value={consultantName} onChangeText={setConsultantName} placeholder="Name or firm" maxLength={200} className={inputClass} />
      </View>
      <View className="mt-3">
        <FieldLabel>Consultant email</FieldLabel>
        <TextInput value={consultantEmail} onChangeText={setConsultantEmail} placeholder="For reminders" keyboardType="email-address" autoCapitalize="none" maxLength={320} className={inputClass} />
      </View>
      <View className="mt-3">
        <FieldLabel>Days to reissue</FieldLabel>
        <TextInput value={responseDays} onChangeText={(t) => setResponseDays(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={2} className={inputClass} />
      </View>
      <View className="mt-3">
        <FieldLabel>First issue (R0) PDF</FieldLabel>
        <Pressable onPress={pick} className="border border-dashed border-neutral-300 rounded-lg px-3 py-3" style={{ minHeight: 48 }}>
          <Text className="text-sm text-neutral-700">{file ? `${file.name}${file.size ? ` · ${formatBytes(file.size)}` : ''}` : 'Choose a PDF…'}</Text>
        </Pressable>
        <Text className="text-2xs text-neutral-400 mt-1">Optional now — you can upload it from the sheet later. Up to {MAX_DRAWING_PDF_MB} MB.</Text>
      </View>
    </BottomSheet>
  );
}
